/**
 * dsh-token-burner —— 宿主侧：装上就开烧。
 *
 * 燃烧器只有一件事：在 apply 里起 N 条 `ctx.llm.stream()` 的循环，每一轮喂一段
 * 「写尽可能长的长文」的提示，把返回的 token 全部丢掉。token 花掉了，磁盘上什么
 * 都不留，所以这不是在攒上下文，是在按最大速率烧钱。
 *
 * 三个刻意的选择：
 *   1. 走 `ctx.llm`，不走 `sessionController.prompt`。
 *      prompt() 只是把消息塞进 Agent 的 inbox 就返回（见 api-session-controller 的
 *      admit 实现），既拿不到"这一轮烧了多少 token"，关插件时也没法确认队列已经空了；
 *      而 `ctx.llm.stream()` 是同步流 + AbortSignal，abort 之后真的一条请求都不再发，
 *      而且流末尾的 `usage` 分片能给出 provider 计费的原始数字。
 *   2. 每轮都在提示里塞一个随机 nonce。同一条提示反复发会命中 provider 的 prompt
 *      cache（缓存命中价通常只有 1/10），那就不是在"快速消耗"了。nonce 让它每次都
 *      是全新前缀，按全价计费。
 *   3. 停止 = running=false + abort。没有排队、没有重试队列，所以"关闭就会停止"
 *      不是慢慢停，是当前这条流断掉就没了。
 *
 * 计费是真的：这里每 1k token 都会出现在账单上。没有 dry-run。
 */

/** 面板/控制接口的路径前缀。 */
const API = '/plugins/dsh-token-burner/api'

/** 一条请求都没发出去时不至于空转的兜底配置。 */
const DEFAULTS = {
  autoStart: true,
  provider: 'magpie',
  model: 'workbuddy/deepseek-v4.1-flash',
  workers: 3,
  maxTokens: 8192,
  gapMs: 250,
  fillerKb: 0,
  reasoningEffort: '',
  system: '你是压测用的长文生成器。只输出正文，不要提纲、不要总结、不要道歉、不要反问，也不要调用任何工具。',
  prompt: [
    '压测任务 {nonce}。',
    '请随机挑一个技术话题，写一篇尽可能长的中文长文，不少于 4000 字：',
    '要有具体例子、数字和取舍分析，段落之间不要重复句式，也不要复述本段要求。',
    '现在直接开始输出正文。',
  ].join('\n'),
}

/** 把配置里的脏值收成可用的数字，越界就夹住而不是抛错。 */
function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 只接受非空字符串，其余回退默认值。 */
function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** 一轮唯一标记：防止 provider 侧前缀缓存把重发的提示算成折扣价。 */
function nonce() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 把任意 throw 收成一行能给面板看的文本。 */
function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  const message = error.message ?? error.code ?? String(error)
  return String(message).split('\n')[0].slice(0, 300)
}

/** 这些错误重试没有意义：额度/凭据/模型不存在，继续打只是刷日志。 */
function fatal(error) {
  const line = describe(error)
  return /quota|balance|credit|insufficient|unauthorized|invalid[_ -]?api|401|403|enotfound|model[_ -]?not/i.test(
    line,
  )
}

/** 可被 abort 叫醒的 sleep；用 Promise 是为了不占一个真实定时器去等。 */
function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * 收配置。
 * @param {unknown} config - patch 行里的 `config`。
 * @returns {typeof DEFAULTS} 归一化后的配置。
 */
function normalize(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    autoStart: raw.autoStart !== false,
    provider: text(raw.provider, DEFAULTS.provider),
    model: text(raw.model, DEFAULTS.model),
    workers: clampInt(raw.workers, DEFAULTS.workers, 1, 32),
    maxTokens: clampInt(raw.maxTokens, DEFAULTS.maxTokens, 64, 200_000),
    gapMs: clampInt(raw.gapMs, DEFAULTS.gapMs, 0, 60_000),
    fillerKb: clampInt(raw.fillerKb, DEFAULTS.fillerKb, 0, 512),
    reasoningEffort: text(raw.reasoningEffort, ''),
    system: text(raw.system, DEFAULTS.system),
    prompt: text(raw.prompt, DEFAULTS.prompt),
  }
}

/**
 * 燃烧器本体。
 * @param {any} ctx - Host 插件上下文（要 llm）。
 * @param {typeof DEFAULTS} cfg - 归一化配置。
 * @param {(line: string) => void} log - 宿主日志。
 */
function createBurner(ctx, cfg, log) {
  const stats = {
    turns: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  }

  let running = false
  let controller = null
  let startedAt = 0
  let stoppedAt = 0
  let stopReason = ''
  let lastError = ''
  let inflight = 0
  let lastTurnMs = 0
  const tasks = new Set()

  /** 提供商没给 totalTokens 时就自己加。 */
  function addUsage(usage) {
    if (usage === null || typeof usage !== 'object') return
    const input = Number(usage.inputTokens) || 0
    const output = Number(usage.outputTokens) || 0
    stats.inputTokens += input
    stats.outputTokens += output
    stats.totalTokens += Number(usage.totalTokens) || input + output
    stats.cacheReadTokens += Number(usage.cacheReadTokens) || 0
    stats.reasoningTokens += Number(usage.reasoningTokens) || 0
  }

  /** 面板拿去渲染的那一份状态。纯读，不碰运行态。 */
  function snapshot() {
    const now = Date.now()
    const elapsed = running ? now - startedAt : stoppedAt - startedAt
    const minutes = elapsed > 0 ? elapsed / 60_000 : 0
    return {
      ok: true,
      running,
      provider: cfg.provider,
      model: cfg.model,
      workers: cfg.workers,
      maxTokens: cfg.maxTokens,
      gapMs: cfg.gapMs,
      fillerKb: cfg.fillerKb,
      autoStart: cfg.autoStart,
      startedAt: startedAt === 0 ? null : startedAt,
      elapsedMs: Math.max(0, elapsed),
      turns: stats.turns,
      errors: stats.errors,
      inflight,
      lastTurnMs,
      stopReason,
      lastError,
      tokens: {
        input: stats.inputTokens,
        output: stats.outputTokens,
        total: stats.totalTokens,
        cacheRead: stats.cacheReadTokens,
        reasoning: stats.reasoningTokens,
      },
      tokensPerMin: minutes > 0 ? Math.round(stats.totalTokens / minutes) : 0,
      turnsPerMin: minutes > 0 ? Math.round((stats.turns / minutes) * 10) / 10 : 0,
    }
  }

  /**
   * 一次性铺好的填充文。
   *
   * 生成速度是有天花板的（实测单路 40–120 token/s，8 路加起来也就 300 出头），
   * 想再快只能从**输入侧**下手：prefill 是并行吞吐，比逐 token 生成快一个量级。
   *
   * 重复文本会不会被缓存吃掉？不会——每条消息最前面都带一个随机 stamp，
   * 前缀从第一个 token 就分叉了，provider 的 prefix cache 匹配不到，按全价算。
   */
  const PAD_UNIT =
    '这一段是压测填充文本，用来把输入侧撑大；内容没有意义，请整体忽略，只执行后面那句真正的指令。'
  const filler =
    cfg.fillerKb > 0
      ? PAD_UNIT.repeat(Math.ceil((cfg.fillerKb * 1024) / PAD_UNIT.length)).slice(0, cfg.fillerKb * 1024)
      : ''

  /** 一条流。返回时这一轮的 token 已经记进 stats。 */
  async function one(index, signal) {
    // stamp 打头：保证每一轮都是全新前缀（不吃缓存折扣）。
    const stamp = nonce()
    const body = cfg.prompt.replaceAll('{nonce}', stamp)
    const prompt = filler === '' ? `${stamp}\n${body}` : `${stamp}\n${filler}\n${body}`
    inflight += 1
    try {
      const stream = ctx.llm.stream({
        provider: cfg.provider,
        model: cfg.model,
        system: cfg.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: cfg.maxTokens,
        ...(cfg.reasoningEffort === '' ? {} : { reasoningEffort: cfg.reasoningEffort }),
        signal,
      })
      for await (const chunk of stream) {
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'usage') {
          addUsage(chunk.usage)
          continue
        }
        if (chunk.type !== 'finish') continue
        const kind = chunk.reason?.kind
        if (kind === 'error') throw new Error(chunk.reason?.failure?.message ?? '模型返回错误')
        if (kind === 'aborted') return
      }
    } finally {
      inflight -= 1
    }
  }

  /** 一条并发 lane：一直烧到 running 变假或信号 abort。 */
  async function burn(index, signal) {
    while (running && !signal.aborted) {
      const began = Date.now()
      try {
        await one(index, signal)
        if (!running) break
        stats.turns += 1
        lastTurnMs = Date.now() - began
      } catch (error) {
        if (!running || signal.aborted) break
        stats.errors += 1
        lastError = describe(error)
        log(`[token-burner] lane ${String(index)} 失败：${lastError}`)
        if (fatal(lastError)) {
          // 额度/凭据问题：立刻停掉所有 lane，而不是把余额再打几十次。
          void stop(`致命错误：${lastError}`)
          break
        }
        if (stats.errors >= 12) {
          // 连环失败（网关没起、模型挂了）：退避几十秒也救不回来，别让它在后台空转刷日志。
          void stop(`连续失败 ${String(stats.errors)} 次，已自动停止`)
          break
        }
        await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(stats.errors, 5)), signal)
      }
      if (running) await sleep(cfg.gapMs, signal)
    }
  }

  /** 把计数器归零，只保留本轮的数字，面板才好读。 */
  function reset() {
    stats.turns = 0
    stats.errors = 0
    stats.inputTokens = 0
    stats.outputTokens = 0
    stats.totalTokens = 0
    stats.cacheReadTokens = 0
    stats.reasoningTokens = 0
    lastError = ''
    lastTurnMs = 0
    stopReason = ''
    stoppedAt = 0
  }

  /** 开烧。已经开着就直接返回，不叠第二层。 */
  async function start() {
    if (running) return { ok: false, error: '已经在烧了' }
    if (typeof ctx.llm?.stream !== 'function') {
      return { ok: false, error: 'ctx.llm 不可用：请确认 profile 挂了 @deepseek-ai/dsh-llm 和提供方适配器' }
    }
    try {
      if (typeof ctx.llm.resolveModelInfo === 'function') {
        await ctx.llm.resolveModelInfo(cfg.provider, cfg.model)
      }
    } catch (error) {
      lastError = `模型不可用：${describe(error)}`
      stopReason = lastError
      return { ok: false, error: lastError }
    }

    reset()
    running = true
    controller = new AbortController()
    startedAt = Date.now()
    const signal = controller.signal
    for (let index = 1; index <= cfg.workers; index += 1) {
      const task = burn(index, signal).catch((error) => {
        log(`[token-burner] lane ${String(index)} 崩了：${describe(error)}`)
      })
      tasks.add(task)
      void task.finally(() => tasks.delete(task))
    }
    log(
      `[token-burner] v2 开烧：${cfg.workers} 路 · ${cfg.provider}/${cfg.model} · maxTokens=${String(cfg.maxTokens)} · filler=${String(cfg.fillerKb)}KB`,
    )
    return { ok: true }
  }

  /**
   * 熄火：先关闸（running=false），再 abort 当前所有流。
   * 没有队列，所以这里返回时不会再有任何新请求发出去。
   */
  async function stop(reason) {
    if (!running) return { ok: true, already: true }
    running = false
    stopReason = reason ?? '手动停止'
    stoppedAt = Date.now()
    try {
      controller?.abort(new Error('token-burner stopped'))
    } catch {
      /* abort 不接受参数也不会有事 */
    }
    // 等流收尾，但最多等 3 秒：abort 之后 provider 可能还有半截响应在飞。
    const pending = [...tasks]
    await Promise.race([Promise.allSettled(pending), sleep(3_000)])
    tasks.clear()
    inflight = 0
    log(
      `[token-burner] 熄火（${stopReason}）：${String(stats.turns)} 轮 · ${String(stats.totalTokens)} tokens`,
    )
    return { ok: true }
  }

  return { start, stop, snapshot, cfg }
}

/** 包名，loader 用它挂这一行。 */
export const name = 'dsh-token-burner'

/** 要消费的宿主服务；少一个 apply 就不会被调用。 */
export const inject = ['llm', 'webServer', 'connection']

/**
 * 挂载。
 * @param {any} ctx - Host 插件上下文。
 * @param {any} config - patch 行里的 config。
 */
export function apply(ctx, config) {
  const cfg = normalize(config)
  const log = (line) => {
    try {
      ctx.logger?.info?.(line)
    } catch {
      /* logger 挂了也不影响烧 */
    }
    try {
      console.log(line)
    } catch {
      /* 同上 */
    }
  }

  const burner = createBurner(ctx, cfg, log)
  const disposers = []
  const json = (res, status, body) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  /** 只认本机回环。端口万一被绑到 0.0.0.0，这条能挡住局域网里的手。 */
  const loopback = (req) => {
    const host = String(req.headers?.host ?? '').toLowerCase().split(':')[0]
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  }

  /**
   * 信任栅栏：connection 服务不可用时 fail-closed（这是能烧钱的接口，不能放行）。
   * 与 dsh-bili-whale 的做法一致。
   */
  const rejected = (req, res) => {
    if (!loopback(req)) {
      json(res, 403, { ok: false, error: '只接受本机回环访问' })
      return true
    }
    try {
      const connection = ctx.get('connection') ?? ctx.connection
      if (!connection || typeof connection.requestRejection !== 'function') {
        json(res, 503, { ok: false, error: '信任栅栏不可用，拒绝访问' })
        return true
      }
      const code = connection.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (error) {
      json(res, 503, { ok: false, error: `信任栅栏异常：${describe(error)}` })
      return true
    }
  }

  /** 读一个短 JSON body（面板只会发很小的对象）。 */
  const readBody = async (req) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 16_384) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    return raw === '' ? {} : JSON.parse(raw)
  }

  /** 注册一条带栅栏的 JSON 路由。 */
  const route = (path, handler) => {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try {
            await handler(req, res)
          } catch (error) {
            try {
              json(res, 500, { ok: false, error: describe(error) })
            } catch {
              /* 响应可能已经发出 */
            }
          }
        },
      }),
    )
  }

  route(`${API}/state`, async (_req, res) => {
    json(res, 200, burner.snapshot())
  })

  route(`${API}/start`, async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '用 POST' })
      return
    }
    json(res, 200, await burner.start())
  })

  route(`${API}/stop`, async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '用 POST' })
      return
    }
    json(res, 200, await burner.stop('面板停止'))
  })

  ctx.effect(() => () => {
    // 停用 / 卸载 / 关机：先熄火，再拆路由。abort 是同步生效的，之后不会再发请求。
    void burner.stop('插件已停用')
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 路由可能已经被宿主拆掉 */
      }
    }
  })

  if (cfg.autoStart) {
    void burner.start().then((result) => {
      if (result?.ok !== true) log(`[token-burner] 自动开烧失败：${String(result?.error ?? '未知原因')}`)
    })
  } else {
    log('[token-burner] 已挂载，autoStart=false，等面板点开始')
  }
}

export default { name, inject, apply }
