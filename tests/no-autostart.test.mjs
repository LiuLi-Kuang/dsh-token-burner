/**
 * 回归测试：**默认不能自启动**。
 *
 * 背景：0.1.0 里 `autoStart` 默认是 true，2026-11-24 用户开机就被烧了一轮
 * （92 秒 / 15,061,579 token）。这个测试锁死那条默认值，防止以后又"顺手"改回开。
 *
 *   node tests/no-autostart.test.mjs
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { apply } from '../entry.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 档位会落盘，测试写进临时 DSH_HOME，别动真实的那份。
process.env.DSH_HOME = path.join(os.tmpdir(), 'dsh-token-burner-test-noauto')
// 每次从干净状态开始：这个文件会跨轮次保留上一次选的档位/语言/模型。
mkdirSync(process.env.DSH_HOME, { recursive: true })
rmSync(path.join(process.env.DSH_HOME, 'token-burner.json'), { force: true })

/** 假模型：只数调用次数，永远不会被调用才对。 */
function makeCtx(counter) {
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
          counter.calls += 1
          return (async function* empty() {
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

/** 发一个假请求。 */
async function call(handler) {
  const req = { method: 'GET', headers: { host: '127.0.0.1:65100' } }
  let body = ''
  const res = { statusCode: 0, setHeader: () => {}, end: (chunk) => (body += chunk ?? '') }
  await handler(req, res)
  return body === '' ? null : JSON.parse(body)
}

// 1) 完全不给 autoStart
{
  const counter = { calls: 0 }
  const { ctx, routes } = makeCtx(counter)
  apply(ctx, {})
  await sleep(300)
  assert.equal(counter.calls, 0, '不写 autoStart 时不该有任何请求')
  const state = await call(routes.get('/plugins/dsh-token-burner/api/state'))
  assert.equal(state.running, false, '不写 autoStart 时不该在跑')
  assert.equal(state.autoStart, false, '快照里的 autoStart 应该是 false')
}

// 2) 写成字符串 "true" 也不算开（只认布尔 true）
{
  const counter = { calls: 0 }
  const { ctx } = makeCtx(counter)
  apply(ctx, { autoStart: 'true' })
  await sleep(200)
  assert.equal(counter.calls, 0, 'autoStart 只认布尔 true，字符串不算')
}

// 3) 显式 false
{
  const counter = { calls: 0 }
  const { ctx } = makeCtx(counter)
  apply(ctx, { autoStart: false })
  await sleep(200)
  assert.equal(counter.calls, 0, 'autoStart: false 不该发请求')
}

console.log('✓ 回归测试通过：默认不开烧，只有显式 autoStart: true 才会自启动')
