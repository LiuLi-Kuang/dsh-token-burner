/**
 * 模型目录、切模型、四档预设的回归测试（宿主半边，假 llm，不联网不花钱）。
 *
 *   node tests/model.test.mjs
 *
 * 盖住五件事：
 *   1. /catalog 把宿主的提供方和模型目录带出来，并且当前这一项一定在里面
 *   2. /model 切过去以后状态、落盘文件都跟着变
 *   3. 不存在的模型被拒，而且不动现有配置
 *   4. 预设是四档（8×32 / 16×64 / 64×128 / 128×256），默认仍是 max
 *   5. 128 路 extreme 档能起、能停，不会因为偶发错误被"连续失败"阈值误停
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { apply } from '../entry.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const HOME = path.join(os.tmpdir(), 'dsh-token-burner-test-model')
process.env.DSH_HOME = HOME
// 每次从干净状态开始：这个文件会跨轮次保留上一次选的档位/语言/模型。
mkdirSync(HOME, { recursive: true })
rmSync(path.join(HOME, 'token-burner.json'), { force: true })

const CATALOG = {
  magpie: ['auto/glm-5.3-flash', 'workbuddy/deepseek-v4.1-flash'],
  asia: ['agnes-3.0-flash', 'agnes-2.5-flash'],
}
const calls = { listed: 0, streamed: 0 }

function makeCtx(counter) {
  const routes = new Map()
  const connection = { requestRejection: () => undefined }
  // 宿主的「默认模型」服务：profile 里给新 agent 用的那一条
  const agentDefaultModel = { currentSelection: () => ({ provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }) }
  return {
    routes,
    ctx: {
      llm: {
        listProviders() {
          return [{ id: 'magpie', displayName: 'Magpie' }, { id: 'asia', displayName: 'asia' }]
        },
        async listModels(provider) {
          counter.listed += 1
          return (CATALOG[provider] ?? []).map((id) => ({ provider, id, name: id.toUpperCase() }))
        },
        async resolveModelInfo(provider, model) {
          if ((CATALOG[provider] ?? []).includes(model) === false) throw new Error(`unknown model ${provider}/${model}`)
          return { id: model }
        },
        stream() {
          counter.streamed += 1
          // 每 40 条里混 1 条失败：128 路下偶发错误是常态，不该触发"连续失败全停"
          const n = counter.streamed
          return (async function* chunks() {
            if (n % 40 === 0) {
              yield { type: 'finish', reason: { kind: 'error', failure: { code: 'ECONNRESET', message: 'socket hang up' } } }
              return
            }
            yield { type: 'usage', usage: { inputTokens: 128, outputTokens: 2, totalTokens: 130 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      get: (key) => (key === 'connection' ? connection : key === 'agentDefaultModel' ? agentDefaultModel : undefined),
      connection,
      webServer: {
        register(spec) {
          routes.set(spec.path, spec.handler)
          return () => routes.delete(spec.path)
        },
      },
      effect(fn) {
        fn()
        return () => {}
      },
    },
  }
}

async function call(handler, { method = 'GET', body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = {
    method,
    headers: { host: '127.0.0.1:65100', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
  let out = ''
  const res = { statusCode: 0, setHeader: () => {}, end: (chunk) => (out += chunk ?? '') }
  await handler(req, res)
  return out === '' ? null : JSON.parse(out)
}

const BASE = '/plugins/dsh-token-burner/api'
const counter = { listed: 0, streamed: 0 }
const { ctx, routes } = makeCtx(counter)
apply(ctx, {}) // 默认配置：autoStart=false，preset=max；提供方/模型留空

// 4) 四档预设，默认 max
const initial = await call(routes.get(`${BASE}/state`))
assert.deepEqual(
  initial.presets.map((item) => [item.key, item.workers, item.fillerKb]),
  [
    ['high', 8, 32],
    ['max', 16, 64],
    ['ultra', 64, 128],
    ['extreme', 128, 256],
  ],
  '预设应该是四档，从小到大',
)
assert.equal(initial.preset, 'max', '默认档仍然是 max')
assert.equal(initial.provider, 'magpie', '提供方留空时应跟随宿主默认模型')
assert.equal(initial.model, 'workbuddy/deepseek-v4.1-flash', '模型留空时应跟随宿主默认模型')
assert.equal(initial.workers, 16)

// 1) 目录
const catalog = await call(routes.get(`${BASE}/catalog`))
assert.equal(catalog.ok, true)
assert.deepEqual(
  catalog.providers.map((item) => [item.id, item.name, item.models.length]),
  [
    ['magpie', 'Magpie', 2],
    ['asia', 'asia', 2],
  ],
  '目录应带出两个提供方及各自的模型数',
)
assert.equal(catalog.provider, 'magpie')
const listedOnce = counter.listed

// 2) 切模型
const switched = await call(routes.get(`${BASE}/model`), { method: 'POST', body: { provider: 'asia', model: 'agnes-3.0-flash' } })
assert.equal(switched.ok, true, JSON.stringify(switched))
const after = await call(routes.get(`${BASE}/state`))
assert.equal(after.provider, 'asia')
assert.equal(after.model, 'agnes-3.0-flash')
const saved = JSON.parse(readFileSync(path.join(HOME, 'token-burner.json'), 'utf8'))
assert.equal(saved.provider, 'asia', '提供方应落盘')
assert.equal(saved.model, 'agnes-3.0-flash', '模型应落盘')
// 目录要重新兜底当前项：当前是 asia，所以 still there
const catalog2 = await call(routes.get(`${BASE}/catalog`))
assert.equal(catalog2.provider, 'asia')
assert.ok(counter.listed > listedOnce, '切模型后目录应重建（当前项变了）')

// 3) 不存在的模型被拒，配置不动
const bad = await call(routes.get(`${BASE}/model`), { method: 'POST', body: { provider: 'asia', model: 'no-such-model' } })
assert.equal(bad.ok, false, '不存在的模型应被拒')
const afterBad = await call(routes.get(`${BASE}/state`))
assert.equal(afterBad.provider, 'asia')
assert.equal(afterBad.model, 'agnes-3.0-flash', '被拒后配置不该变')

// 5) extreme 档：128 路起停
const toExtreme = await call(routes.get(`${BASE}/preset`), { method: 'POST', body: { preset: 'extreme' } })
assert.equal(toExtreme.ok, true)
const started = await call(routes.get(`${BASE}/start`), { method: 'POST' })
assert.equal(started.ok, true)
await sleep(400)
const burning = await call(routes.get(`${BASE}/state`))
assert.equal(burning.running, true, `128 路应该在跑，实际已停：${burning.stopCode} / ${burning.lastError ?? ''}`)
assert.equal(burning.workers, 128)
assert.ok(burning.turns >= 128, `128 路各至少跑完一轮，实际 ${burning.turns}`)
assert.ok(burning.errors >= 1, '假模型每 40 条混一条失败，这里应该已经有错误')
const stopped = await call(routes.get(`${BASE}/stop`), { method: 'POST' })
assert.equal(stopped.ok, true)
assert.equal((await call(routes.get(`${BASE}/state`))).running, false)

// 6) 保存过的路由失效了（换过机器、提供方被删）：开烧时自动退回宿主默认模型，而不是罢工
writeFileSync(path.join(HOME, 'token-burner.json'), JSON.stringify({ provider: 'ghost', model: 'nope' }))
const fresh = { listed: 0, streamed: 0 }
const second = makeCtx(fresh)
apply(second.ctx, {})
assert.equal((await call(second.routes.get(`${BASE}/state`))).provider, 'ghost', '启动时应先沿用保存的那条')
const recovered = await call(second.routes.get(`${BASE}/start`), { method: 'POST' })
assert.equal(recovered.ok, true, `失效路由应被默认模型救回来：${JSON.stringify(recovered)}`)
const afterRecover = await call(second.routes.get(`${BASE}/state`))
assert.equal(afterRecover.provider, 'magpie', '应退回宿主默认模型')
assert.equal(afterRecover.model, 'workbuddy/deepseek-v4.1-flash')
await call(second.routes.get(`${BASE}/stop`), { method: 'POST' })

console.log('✓ 模型测试通过：跟随宿主默认模型、目录、切模型、落盘、拒绝非法模型、失效路由自动退回、四档预设、128 路起停')
console.log(`  假请求 ${counter.streamed} 条，其中失败 ${burning.errors} 条，没有被误停`)
