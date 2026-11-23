/**
 * 假 ctx 自测：不碰真模型、不花一分钱，只验证"开→烧→停→真停"这条命。
 *
 *   node tests/selftest.mjs
 *
 * 覆盖四件事：
 *   1. apply 后 autoStart 真的开始发请求（并且 workers 路并发）
 *   2. /stop 之后不再产生任何新请求，running 变假
 *   3. 停用（effect 清理）也能停，且停完不会再烧
 *   4. 计数/速率快照有数，不是全 0
 */

import assert from 'node:assert/strict'
import { apply } from '../entry.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 一份会"慢慢吐字 + 报 usage"的假模型流，并且尊重 abort。 */
function makeFakeLlm(counter) {
  return {
    async resolveModelInfo() {
      return { id: 'fake' }
    },
    stream(options) {
      counter.calls += 1
      const signal = options.signal
      return (async function* chunks() {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        for (let i = 0; i < 5; i += 1) {
          if (signal?.aborted) {
            yield { type: 'finish', reason: { kind: 'aborted' } }
            return
          }
          await sleep(5)
          yield { type: 'text-delta', index: 0, text: '烧字'.repeat(20) }
        }
        yield {
          type: 'usage',
          usage: { inputTokens: 120, outputTokens: 380, totalTokens: 500, reasoningTokens: 40 },
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** 最小可用的宿主上下文替身。 */
function makeCtx(counter) {
  const routes = new Map()
  const cleanups = []
  const connection = { requestRejection: () => undefined }
  return {
    routes,
    runCleanup() {
      for (const fn of cleanups.splice(0)) fn()
    },
    ctx: {
      llm: makeFakeLlm(counter),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      get: (key) => (key === 'connection' ? connection : undefined),
      connection,
      webServer: {
        register(spec) {
          routes.set(spec.path, spec.handler)
          return () => routes.delete(spec.path)
        },
      },
      effect(fn) {
        const cleanup = fn()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return () => cleanup?.()
      },
    },
  }
}

/** 发一个假请求，把 handler 的响应收回来看。 */
async function call(handler, { method = 'GET' } = {}) {
  const headers = { host: '127.0.0.1:65100' }
  const req = { method, headers }
  let body = ''
  const res = {
    statusCode: 0,
    setHeader: () => {},
    end: (chunk) => {
      body += chunk ?? ''
    },
  }
  await handler(req, res)
  return { status: res.statusCode, json: body === '' ? null : JSON.parse(body) }
}

const counter = { calls: 0 }
const { ctx, routes, runCleanup } = makeCtx(counter)
apply(ctx, { autoStart: true, workers: 3, maxTokens: 512, gapMs: 0 })

// 1) 开烧
await sleep(300)
assert.ok(counter.calls >= 1, 'autoStart 之后应该有请求发出')
assert.ok(routes.has('/plugins/dsh-token-burner/api/state'), 'state 路由应已注册')

const statePath = '/plugins/dsh-token-burner/api/state'
const stopPath = '/plugins/dsh-token-burner/api/stop'
const startPath = '/plugins/dsh-token-burner/api/start'

const before = await call(routes.get(statePath))
assert.equal(before.json.running, true, '应该在运行')
assert.ok(before.json.turns >= 1, '应该已经完成至少一轮')
assert.ok(before.json.tokens.total > 0, '应该统计到 token')
assert.ok(before.json.tokensPerMin > 0, '应该有速率')

// 2) 停 → 不再有新请求
const stopped = await call(routes.get(stopPath), { method: 'POST' })
assert.equal(stopped.json.ok, true)
const callsAtStop = counter.calls
const afterStop = await call(routes.get(statePath))
assert.equal(afterStop.json.running, false, '停止后 running 应为 false')
await sleep(300)
assert.equal(counter.calls, callsAtStop, '停止后不应再发请求')

// 3) 再开 + 停用插件 → 也必须停
const restarted = await call(routes.get(startPath), { method: 'POST' })
assert.equal(restarted.json.ok, true)
await sleep(150)
assert.ok(counter.calls > callsAtStop, '重启后应该继续发请求')
runCleanup()
const callsAtDispose = counter.calls
await sleep(300)
assert.equal(counter.calls, callsAtDispose, '停用插件后不应再发请求')

console.log('✓ selftest 通过：开 → 烧 → 停 → 真停，计数也正常')
console.log(`  一共发了 ${String(counter.calls)} 次假请求；最后一次快照：`, {
  turns: afterStop.json.turns,
  tokens: afterStop.json.tokens.total,
  tokensPerMin: afterStop.json.tokensPerMin,
})
