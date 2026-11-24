/**
 * 语言开关的回归测试（宿主半边）：
 *   - 默认 `auto`，解析结果只会是 zh / en
 *   - POST /locale 能切成 en / zh，并且写进 ~/.dsh/token-burner.json
 *   - 非法值被拒，不会把配置写成垃圾
 *   - /stop 回的是**代码**（panel），不是某句话——文案由客户端按语言翻
 *
 *   node tests/locale.test.mjs
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { apply } from '../entry.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const HOME = path.join(os.tmpdir(), 'dsh-token-burner-test-locale')
process.env.DSH_HOME = HOME

function makeCtx() {
  const routes = new Map()
  const connection = { requestRejection: () => undefined }
  return {
    routes,
    ctx: {
      llm: {
        async resolveModelInfo() {
          return { id: 'fake' }
        },
        stream() {
          return (async function* empty() {
            yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
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

const statePath = '/plugins/dsh-token-burner/api/state'
const localePath = '/plugins/dsh-token-burner/api/locale'
const stopPath = '/plugins/dsh-token-burner/api/stop'

const { ctx, routes } = makeCtx()
apply(ctx, {}) // 默认配置

// 1) 默认 auto
const initial = await call(routes.get(statePath))
assert.equal(initial.locale, 'auto', '默认应该是 auto')
assert.ok(['zh', 'en'].includes(initial.resolvedLocale), `resolvedLocale 只能是 zh/en，实际 ${initial.resolvedLocale}`)

// 2) 切成英文，并落盘
const toEn = await call(routes.get(localePath), { method: 'POST', body: { locale: 'en' } })
assert.equal(toEn.ok, true)
assert.equal(toEn.resolvedLocale, 'en')
const afterEn = await call(routes.get(statePath))
assert.equal(afterEn.locale, 'en')
assert.equal(afterEn.resolvedLocale, 'en', '显式 en 不该再跟随系统')

const saved = JSON.parse(readFileSync(path.join(HOME, 'token-burner.json'), 'utf8'))
assert.equal(saved.locale, 'en', '语言应该写进 token-burner.json')

// 3) 切回跟随系统
const toAuto = await call(routes.get(localePath), { method: 'POST', body: { locale: 'auto' } })
assert.equal(toAuto.ok, true)
assert.ok(['zh', 'en'].includes(toAuto.resolvedLocale))

// 4) 非法值被拒，且不覆盖已存的值
const bad = await call(routes.get(localePath), { method: 'POST', body: { locale: 'fr' } })
assert.equal(bad.ok, false, 'fr 应该被拒')
const afterBad = await call(routes.get(statePath))
assert.equal(afterBad.locale, 'auto', '非法值不该改掉现有语言')

// 5) 停止原因回代码而不是句子
await call(routes.get('/plugins/dsh-token-burner/api/start'), { method: 'POST' })
await sleep(120)
const stopped = await call(routes.get(stopPath), { method: 'POST' })
assert.equal(stopped.ok, true)
const afterStop = await call(routes.get(statePath))
assert.equal(afterStop.stopCode, 'panel', `停止原因应该是代码 panel，实际 ${afterStop.stopCode}`)
assert.equal(afterStop.running, false)

console.log('✓ 语言测试通过：auto 解析、zh/en 覆盖、落盘、非法值拒绝、停止原因是代码')
console.log(`  系统解析结果：${initial.resolvedLocale}（auto 模式下）`)
