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

// ── 用桩子把组件本体渲一遍：界面看不到，至少保证两种状态下 JSX 都能构建出来 ──────
// useState 按调用顺序从队列里取值（state, catalog, busy, err），取完回落初始值。
function renderWith(queue) {
  const ReactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [queue.length > 0 ? queue.shift() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
  }
  const mod2 = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return ReactStub
  })
  return mod2.TokenBurnerSection()
}

function nodes(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return found
  if (Array.isArray(node)) {
    for (const item of node) nodes(item, predicate, found)
    return found
  }
  if (typeof node === 'object') {
    if (predicate(node)) found.push(node)
    for (const child of node.children ?? []) nodes(child, predicate, found)
  }
  return found
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return `${String(node)} `
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}

// 上一步把系统语言切成了 en-US；这里固定回中文，下面的中文断言才成立。
setNavigator('zh-CN')

// 1) 首屏：宿主状态还没回来
const empty = renderWith([])
assert.ok(textOf(empty).includes('Token 燃烧器'), '空状态也要有标题')
// 空状态：开始 / 停止 / 刷新 + 三个语言按钮（档位和提供方要等宿主状态回来才有）
assert.equal(nodes(empty, (item) => item.type === 'button').length, 6, '空状态应是 3 个操作 + 3 个语言按钮')

// 2) 满状态：运行中、五个提供方、25 个模型、extreme 档、带着一次 lane 错误
const models = Array.from({ length: 25 }, (_, i) => ({ id: `workbuddy/m${String(i)}`, name: `模型 ${String(i)}` }))
const fullState = {
  ok: true,
  running: true,
  provider: 'magpie',
  model: 'workbuddy/m7',
  preset: 'extreme',
  workers: 128,
  fillerKb: 256,
  maxTokens: 128,
  gapMs: 0,
  autoStart: false,
  turns: 12,
  elapsedMs: 92000,
  tokensPerMin: 6507000,
  tokens: { input: 9953000, output: 19000, total: 9972000 },
  presets: [
    { key: 'high', workers: 8, fillerKb: 32, label: '8 × 32KB' },
    { key: 'max', workers: 16, fillerKb: 64, label: '16 × 64KB' },
    { key: 'ultra', workers: 64, fillerKb: 128, label: '64 × 128KB' },
    { key: 'extreme', workers: 128, fillerKb: 256, label: '128 × 256KB' },
  ],
  locale: 'auto',
  resolvedLocale: 'zh',
  stopCode: '',
  stopDetail: '',
  lastErrorCode: 'lane-error',
  lastError: 'socket hang up',
}
const fullCatalog = {
  ok: true,
  provider: 'magpie',
  model: 'workbuddy/m7',
  providers: [
    { id: 'deepseek-official', name: 'DeepSeek 官方', models: [] },
    { id: 'deepseek-account', name: 'deepseek-account', models: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
    { id: 'asia', name: 'asia', models: [{ id: 'x', name: 'x' }] },
    { id: 'asia02', name: 'asia02', models: [] },
    { id: 'magpie', name: 'Magpie', models },
  ],
}
const full = renderWith([fullState, fullCatalog, '', ''])
const text = textOf(full)
for (const needle of ['燃烧中', 'Magpie', '64 路 × 128KB', '128 路 × 256KB', '9.97M', '单路请求失败：socket hang up', '跟随系统', '128 路 · 128 max']) {
  assert.ok(text.includes(needle), `满状态缺少文案：${needle}`)
}
assert.ok(text.includes('64 路以上没有实测过'), 'extreme 档要带未实测提示')
assert.ok(!text.includes('切换到'), '没切过档就不该出现切换原因')

const selects = nodes(full, (item) => item.type === 'select')
assert.equal(selects.length, 1, '应该有一个模型下拉')
// 桩子不会像 React 那样摊平数组子节点，所以直接数 option 节点
assert.equal(nodes(full, (item) => item.type === 'option').length, 25, '下拉里是当前提供方的全部模型')
assert.equal(selects[0].props.value, 'workbuddy/m7', '下拉选中当前模型')

const buttons = nodes(full, (item) => item.type === 'button')
// 3 个操作 + 5 个提供方 + 4 档 + 3 个语言
assert.equal(buttons.length, 15, `按钮总数应为 15，实际 ${String(buttons.length)}`)
assert.equal(buttons.filter((item) => item.props['data-on'] === '1').length, 3, '提供方 / 档位 / 语言各有一个选中')
assert.equal(buttons[0].props.disabled, true, '运行中「开始」应禁用')
// deepseek-official 和 asia02 在目录里没有模型：按钮置灰并带说明
const providerButtons = buttons.filter((item) => buttons.indexOf(item) >= 3 && buttons.indexOf(item) <= 7)
assert.equal(providerButtons.filter((item) => item.props.disabled === true).length, 2, '没有可用模型的提供方应置灰')
assert.equal(providerButtons[0].props.title, '这个提供方没有可用模型')
assert.equal(providerButtons[4].props.title, undefined, '有模型的提供方不该带"没有模型"的提示')
// 下拉外面要有自己的箭头
assert.equal(nodes(full, (item) => item.props?.className === 'tb-caret').length, 1, '模型下拉应带自绘箭头')
assert.equal(buttons[1].props.disabled, false, '运行中「停止」应可点')

// 3) 刚切过模型
const switched = renderWith([{ ...fullState, running: false, stopCode: 'model-switch', stopDetail: 'asia/x', lastErrorCode: '', lastError: '' }, fullCatalog, '', ''])
assert.ok(textOf(switched).includes('已切到 asia/x'), 'model-switch 原因要能翻译出来')

console.log('✓ 组件渲染自测通过：空状态 / 满状态（5 提供方 · 25 模型 · 四档）/ 切模型原因')
