/**
 * dsh-token-burner —— 客户端半边：DSH「设置」里的一节（不是浮窗）。
 *
 * 结构照抄 dsh-bili-whale 的 settings section：`ctx.slots.inject('settings.section')`
 * 注册一个组件，DSH 自己负责把它放进设置侧栏。所以这里没有 fixed 定位、没有 z-index，
 * 也没有任何覆盖在聊天界面上的东西。
 *
 * 数据流：section ⇄ `/plugins/dsh-token-burner/api/*`（同源 fetch）⇄ 宿主里的燃烧器。
 * 宿主那半边是唯一真相：这里只负责显示数字和发 开始/停止 两个动词。
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-burner',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    const API = '/plugins/dsh-token-burner/api'

    const CSS_TAG = 'dsh-token-burner/section.css'
    const CSS = [
      '.tb{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}',
      '.tb-title{margin:0;font-size:16px;font-weight:500;line-height:24px;display:flex;align-items:center;gap:8px}',
      '.tb-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}',
      '.tb-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.tb-dot[data-on="1"]{background:#ff7a2f;box-shadow:0 0 0 4px rgba(255,122,47,.18)}',
      '.tb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}',
      '.tb-card{background:rgba(127,127,127,.08);border-radius:10px;padding:10px 12px}',
      '.tb-k{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}',
      '.tb-v{font-size:16px;font-weight:600;line-height:24px;font-variant-numeric:tabular-nums}',
      '.tb-rows{display:flex;flex-direction:column;margin-top:12px}',
      '.tb-row{display:flex;justify-content:space-between;gap:12px 20px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:19px;flex-wrap:wrap}',
      '.tb-row:last-child{border-bottom:none}',
      '.tb-row__k{color:var(--dsw-alias-label-tertiary)}',
      '.tb-row__v{font-variant-numeric:tabular-nums}',
      '.tb-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.tb-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer}',
      '.tb-btn:disabled{opacity:.5;cursor:default}',
      '.tb-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.tb-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}',
      '.tb-warn{margin-top:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:rgba(226,86,31,.10);border-radius:8px;padding:10px 12px}',
      '.tb-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin-top:6px}',
    ].join('')

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === 'undefined') return
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement('style')
          el.id = CSS_TAG
          el.textContent = CSS
          document.head.appendChild(el)
        }
      }, [])
    }

    const fmt = (value) => {
      const n = Number(value) || 0
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
      return String(Math.round(n))
    }

    const clock = (ms) => {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      const m = Math.floor(total / 60)
      const s = total % 60
      return `${String(m)}:${String(s).padStart(2, '0')}`
    }

    function TokenBurnerSection() {
      useStyleOnce()
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const alive = useRef(true)

      const refresh = useCallback(async () => {
        try {
          const response = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const next = await response.json()
          if (!alive.current) return
          setState(next)
          setErr('')
        } catch (error) {
          if (!alive.current) return
          setErr(`宿主接口读不到：${String(error?.message ?? error)}（插件可能刚被停用）`)
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void refresh()
        const timer = setInterval(() => void refresh(), 1500)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [refresh])

      const control = async (action) => {
        setBusy(action)
        try {
          const response = await fetch(`${API}/${action}`, {
            method: 'POST',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const result = await response.json()
          if (result?.ok !== true) setErr(String(result?.error ?? '操作被拒绝'))
        } catch (error) {
          setErr(`控制失败：${String(error?.message ?? error)}`)
        }
        setBusy('')
        await refresh()
      }

      const running = state?.running === true
      const tokens = state?.tokens ?? {}

      return h(
        'div',
        { className: 'tb' },
        h(
          'h2',
          { className: 'tb-title' },
          h('span', { className: 'tb-dot', 'data-on': running ? '1' : '0', 'aria-hidden': true }),
          'Token 燃烧器',
          h(
            'span',
            { style: { fontSize: 12, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' } },
            running ? '燃烧中' : '已停止',
          ),
        ),
        h(
          'p',
          { className: 'tb-intro' },
          'Host 侧起 N 条 ctx.llm.stream() 循环，把 token 往外倒：返回内容全部丢弃，只记 usage。',
          '停止是即时 abort——没有队列，所以关掉之后不会有“排着队继续烧”的请求。',
        ),

        h(
          'div',
          { className: 'tb-grid' },
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, '总 token'), h('div', { className: 'tb-v' }, fmt(tokens.total))),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, '速率'), h('div', { className: 'tb-v' }, `${fmt(state?.tokensPerMin ?? 0)}/min`)),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, '输入 / 输出'), h('div', { className: 'tb-v' }, `${fmt(tokens.input)} / ${fmt(tokens.output)}`)),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, '轮次 · 时长'), h('div', { className: 'tb-v' }, `${String(state?.turns ?? 0)} · ${clock(state?.elapsedMs)}`)),
        ),

        h(
          'div',
          { className: 'tb-rows' },
          row('提供方 / 模型', `${state?.provider ?? '—'} / ${state?.model ?? '—'}`),
          row('并发 · 输出上限', `${String(state?.workers ?? '—')} 路 · ${fmt(state?.maxTokens ?? 0)} max`),
          row('输入填充', Number(state?.fillerKb ?? 0) > 0 ? `${String(state.fillerKb)} KB/请求` : '关（纯输出流）'),
          row('自动开烧', state?.autoStart === true ? '开（加载即烧）' : '关（手动）'),
          row('错误 / 停止原因', state?.lastError || state?.stopReason || '—'),
        ),

        err === '' ? null : h('div', { className: 'tb-err' }, err),

        h(
          'div',
          { className: 'tb-actions' },
          h(
            'button',
            { className: 'tb-btn', onClick: () => void control('start'), disabled: running || busy !== '' },
            busy === 'start' ? '启动中…' : running ? '烧着呢' : '开始',
          ),
          h(
            'button',
            { className: 'tb-btn tb-btn2', onClick: () => void control('stop'), disabled: !running || busy !== '' },
            busy === 'stop' ? '停止中…' : '停止',
          ),
          h('button', { className: 'tb-btn tb-btn2', onClick: () => void refresh(), disabled: busy !== '' }, '刷新'),
        ),

        h(
          'div',
          { className: 'tb-warn' },
          '⚠️ 真账单，没有 dry-run。',
          '输入流（填充开）烧的是便宜的输入 token，数字涨得快；输出流（填充关 + 大 maxTokens）单价贵但受生成速度限制。',
          '旋钮都在插件的 cordis.patch.yml 里，改完 Host 会自动重组。',
        ),
        h(
          'div',
          { className: 'tb-hint' },
          '也可以用插件页的整体开关来启停；停用会先熄火再拆路由，效果和「停止」一样。',
        ),
      )
    }

    /** 一行 k/v。 */
    function row(key, value) {
      return h(
        'div',
        { className: 'tb-row' },
        h('span', { className: 'tb-row__k' }, key),
        h('span', { className: 'tb-row__v' }, String(value)),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'token-burner', order: 7, label: () => 'Token 燃烧器' },
              TokenBurnerSection,
            ),
            'token-burner: settings section',
          ),
        'token-burner: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.TokenBurnerSection = TokenBurnerSection
    return module.exports
  },
})
