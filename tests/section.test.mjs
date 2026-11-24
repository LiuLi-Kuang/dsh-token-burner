/**
 * 客户端半边的结构自测：不碰浏览器，只验证「模块能被 loader 收下、apply 真的把
 * settings.section 注册上」这两件事。
 *
 *   node tests/section.test.mjs
 *
 * 重点不是渲染（那要真浏览器），而是最容易写错的三处：
 *   1. id 和包名对不上 → loader 找不到模块
 *   2. exports.inject 少了 'slots' → apply 根本不会拿到 ctx.slots
 *   3. 注册的 slot 名/组件名写错 → 设置里什么都不出现，而且不报错
 */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

/** 够 apply 跑通的假 React：组件本身不被渲染，所以 hooks 只给空壳。 */
const ReactStub = {
  createElement: (...args) => ({ type: 'element', args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}

const entry = path.join(import.meta.dirname, '..', 'client.js')
await import(pathToFileURL(entry).href)

assert.ok(loaded !== null, 'client.js 应该调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, 'dsh-token-burner', 'loader id 必须等于包名')

const mod = loaded.factory((specifier) => {
  assert.equal(specifier, 'react', `只应该 require react，实际：${specifier}`)
  return ReactStub
})

assert.equal(typeof mod.apply, 'function', 'exports.apply 必须是函数')
assert.deepEqual(mod.inject, ['slots'], 'exports.inject 必须声明 slots，否则拿不到 ctx.slots')

let registered = null
let injectName = ''
const ctx = {
  effect(fn) {
    const cleanup = fn()
    assert.equal(typeof cleanup, 'function', 'effect 必须返回清理函数')
  },
  slots: {
    inject(name, fn) {
      injectName = name
      fn()
      return () => {}
    },
    register(spec, component) {
      registered = { spec, component }
      return () => {}
    },
  },
}

mod.apply(ctx)

assert.equal(injectName, 'settings.section', '必须注入 settings.section 插槽')
assert.ok(registered !== null, '必须注册一个 section')
assert.equal(registered.spec.name, 'settings.section')
assert.equal(registered.spec.id, 'token-burner')
assert.equal(typeof registered.spec.label, 'function')
assert.equal(typeof registered.component, 'function', 'section 必须是函数组件')

// 侧栏标签跟随系统语言。Node 自带 navigator，这里按需改写再断言两个方向。
const setNavigator = (language) => {
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
    return true
  } catch {
    return false
  }
}

if (setNavigator('zh-CN')) {
  assert.equal(registered.spec.label(), 'Token 燃烧器', '中文系统下标签应该是中文')
  setNavigator('en-US')
  assert.equal(registered.spec.label(), 'Token Burner', '英文系统下标签应该是英文')
} else {
  // 拿不到 navigator 的时候只校验它落在两种语言之一
  assert.ok(['Token 燃烧器', 'Token Burner'].includes(registered.spec.label()))
}

// 两张文案表的 key 必须一一对应，否则切换语言会掉文案
const zhKeys = Object.keys(mod.STRINGS.zh).sort()
const enKeys = Object.keys(mod.STRINGS.en).sort()
assert.deepEqual(enKeys, zhKeys, `zh/en 文案 key 不一致：${enKeys.filter((k) => !zhKeys.includes(k)).join(',')}`)

console.log('✓ section 结构自测通过：id / inject / 注册点 / 双语标签都对')
console.log(
  '  挂载点',
  registered.spec.name,
  '· 顺序',
  registered.spec.order,
  '· 文案条目',
  zhKeys.length,
  '× 2 种语言',
)
