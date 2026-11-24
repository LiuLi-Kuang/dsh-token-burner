/**
 * dsh-token-burner —— 客户端半边：DSH「设置」里的一节，中英双语。
 *
 * 语言规则：
 *   - `auto`（默认）跟随系统：宿主用 Intl 拿 OS 区域设置，只有 zh 系才给中文，
 *     其余一律英文；浏览器端在首屏之前用 navigator.language 兜底。
 *   - `zh` / `en` 是设置页里的显式覆盖，存在 ~/.dsh/token-burner.json，重启仍生效。
 *
 * 文案全部走 STRINGS 表；宿主只回**代码**（如 `stopCode: 'panel'`），由这里翻译，
 * 这样加一门语言不用碰宿主。
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

    // ── 文案 ────────────────────────────────────────────────────────────
    const STRINGS = {
      zh: {
        label: 'Token 燃烧器',
        title: 'Token 燃烧器',
        running: '燃烧中',
        idle: '已停止',
        intro1: '宿主侧起 N 条 ctx.llm.stream() 循环，把 token 往外倒：返回内容全部丢弃，只记 usage。',
        intro2: '停止是即时 abort——没有队列，所以关掉之后不会有“排着队继续烧”的请求。',
        total: '总 token',
        rate: '速率',
        rateValue: '{value}/min',
        io: '输入 / 输出',
        turnsTime: '轮次 · 时长',
        providerModel: '提供方 / 模型',
        presetRow: '当前档位',
        presetValue: '{workers} 路 × {kb}KB',
        presetCustom: '自定义 {workers} 路 × {kb}KB',
        lanesMax: '并发 · 输出上限',
        lanesMaxValue: '{workers} 路 · {max} max',
        fillerRow: '输入填充',
        fillerValue: '{kb} KB/请求',
        fillerOff: '关（纯输出流）',
        autoStartRow: '自动开烧',
        autoStartOn: '开（加载即烧）',
        autoStartOff: '关（手动）',
        reasonRow: '错误 / 停止原因',
        start: '开始',
        stop: '停止',
        refresh: '刷新',
        burning: '烧着呢',
        starting: '启动中…',
        stopping: '停止中…',
        switching: '切换中…',
        presetHint: '切档会重建所有流（计数归零）；选择记在 ~/.dsh/token-burner.json，重启之后仍然生效。',
        langRow: '界面语言',
        langAuto: '跟随系统',
        langZh: '中文',
        langEn: 'English',
        langHint: '默认跟随系统；只影响这一页的文案，不影响燃烧。',
        warn:
          '⚠️ 真账单，没有 dry-run。输入流（填充开）烧的是便宜的输入 token，数字涨得快；' +
          '输出流（填充关 + 大 maxTokens）单价贵但受生成速度限制。',
        warnKnobs: '旋钮都在插件的 cordis.patch.yml 里，改完 Host 会自动重组。',
        foot: '也可以用插件页的整体开关来启停；停用会先熄火再拆路由，效果和「停止」一样。',
        errHttp: '宿主接口读不到：{detail}',
        errControl: '控制失败：{detail}',
        errRejected: '操作被拒绝',
        stopPanel: '面板停止',
        stopDisabled: '插件已停用',
        stopSwitch: '切换到 {detail}',
        stopFatal: '致命错误：{detail}',
        stopTooMany: '连续失败 {detail} 次，已自动停止',
        stopModel: '模型不可用：{detail}',
        stopManual: '手动停止',
        stopLane: '单路请求失败：{detail}',
      },
      en: {
        label: 'Token Burner',
        title: 'Token Burner',
        running: 'Burning',
        idle: 'Idle',
        intro1: 'The host runs N concurrent ctx.llm.stream() loops and throws the output away — only usage is counted.',
        intro2: 'Stopping aborts immediately. There is no queue, so nothing keeps burning after you stop it.',
        total: 'Total tokens',
        rate: 'Rate',
        rateValue: '{value}/min',
        io: 'In / Out',
        turnsTime: 'Turns · Uptime',
        providerModel: 'Provider / model',
        presetRow: 'Preset',
        presetValue: '{workers} lanes × {kb}KB',
        presetCustom: 'custom {workers} lanes × {kb}KB',
        lanesMax: 'Lanes · max output',
        lanesMaxValue: '{workers} lanes · {max} max',
        fillerRow: 'Input filler',
        fillerValue: '{kb} KB/request',
        fillerOff: 'off (output only)',
        autoStartRow: 'Auto-start',
        autoStartOn: 'on (starts on load)',
        autoStartOff: 'off (manual)',
        reasonRow: 'Error / stop reason',
        start: 'Start',
        stop: 'Stop',
        refresh: 'Refresh',
        burning: 'Burning',
        starting: 'Starting…',
        stopping: 'Stopping…',
        switching: 'Switching…',
        presetHint: 'Switching rebuilds every lane (counters reset). The choice is saved in ~/.dsh/token-burner.json.',
        langRow: 'Language',
        langAuto: 'System',
        langZh: '中文',
        langEn: 'English',
        langHint: 'Follows the system by default. Only changes this page, not the burn.',
        warn:
          '⚠️ Real bill, no dry run. The input stream (filler on) burns cheap input tokens fast; ' +
          'the output stream (filler off, large maxTokens) is pricier but capped by generation speed.',
        warnKnobs: 'All knobs live in the plugin’s cordis.patch.yml; the host recomposes on save.',
        foot: 'You can also start/stop from the plugin page — disabling it aborts first, same as Stop.',
        errHttp: 'Cannot reach the host: {detail}',
        errControl: 'Control failed: {detail}',
        errRejected: 'Rejected',
        stopPanel: 'Stopped from settings',
        stopDisabled: 'Plugin disabled',
        stopSwitch: 'Switched to {detail}',
        stopFatal: 'Fatal: {detail}',
        stopTooMany: 'Stopped after {detail} consecutive failures',
        stopModel: 'Model unavailable: {detail}',
        stopManual: 'Stopped manually',
        stopLane: 'Lane request failed: {detail}',
      },
    }

    /** 浏览器端兜底：首屏还没拿到宿主状态时用它决定文案。 */
    function detectClientLocale() {
      try {
        const tag = String(globalThis.navigator?.language ?? '').toLowerCase()
        if (tag.startsWith('zh')) return 'zh'
        if (tag !== '') return 'en'
      } catch {
        /* navigator 不可用就走下面的默认 */
      }
      return 'zh'
    }

    /** 取一张文案表，返回 t(key, vars)。缺 key 时回退中文，再回退 key 本身。 */
    function makeT(locale) {
      const table = STRINGS[locale] ?? STRINGS.zh
      return (key, vars) => {
        const template = table[key] ?? STRINGS.zh[key] ?? key
        if (vars === undefined) return template
        return Object.entries(vars).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          template,
        )
      }
    }

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
      '.tb-presets{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}',
      '.tb-seg{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:999px;font-size:12.5px;height:30px;padding:0 14px;cursor:pointer;font-variant-numeric:tabular-nums}',
      '.tb-seg[data-on="1"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.tb-seg:disabled{opacity:.5;cursor:default}',
      '.tb-field{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}',
      '.tb-field__k{color:var(--dsw-alias-label-tertiary);font-size:12.5px}',
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

    /** 一行 k/v。 */
    const row = (key, value) =>
      h(
        'div',
        { className: 'tb-row' },
        h('span', { className: 'tb-row__k' }, key),
        h('span', { className: 'tb-row__v' }, String(value)),
      )

    function TokenBurnerSection() {
      useStyleOnce()
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const alive = useRef(true)

      // 宿主给的是"偏好"（auto/zh/en）与"解析结果"，首屏之前用浏览器语言兜底
      const locale =
        state?.resolvedLocale === 'en' || state?.resolvedLocale === 'zh'
          ? state.resolvedLocale
          : detectClientLocale()
      const t = makeT(locale)

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
          setErr(makeT(detectClientLocale())('errHttp', { detail: String(error?.message ?? error) }))
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

      const control = async (action, payload) => {
        const busyKey =
          action === 'preset'
            ? `preset:${String(payload?.preset ?? '')}`
            : action === 'locale'
              ? `locale:${String(payload?.locale ?? '')}`
              : action
        setBusy(busyKey)
        try {
          const response = await fetch(`${API}/${action}`, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const result = await response.json()
          if (result?.ok !== true) setErr(String(result?.error ?? t('errRejected')))
        } catch (error) {
          setErr(t('errControl', { detail: String(error?.message ?? error) }))
        }
        setBusy('')
        await refresh()
      }

      const running = state?.running === true
      const tokens = state?.tokens ?? {}

      /** 把 stopCode + detail 翻成本地文案（宿主只说代码，语言由这里定）。 */
      const stopText = () => {
        const code = String(state?.stopCode ?? '')
        const detail = String(state?.stopDetail ?? '')
        if (code === '') return '—'
        if (code === 'preset-switch') {
          const preset = (Array.isArray(state?.presets) ? state.presets : []).find((item) => item.key === detail)
          const shown =
            preset === undefined
              ? detail
              : t('presetValue', { workers: preset.workers, kb: preset.fillerKb })
          return t('stopSwitch', { detail: shown })
        }
        const byCode = {
          panel: 'stopPanel',
          'plugin-disabled': 'stopDisabled',
          fatal: 'stopFatal',
          'too-many-errors': 'stopTooMany',
          'model-unavailable': 'stopModel',
          manual: 'stopManual',
        }
        return byCode[code] === undefined ? `${code}: ${detail}` : t(byCode[code], { detail })
      }

      const errorText = () => {
        if (state?.lastErrorCode === 'model-unavailable') return t('stopModel', { detail: state?.lastError ?? '' })
        if (state?.lastErrorCode === 'lane-error') return t('stopLane', { detail: state?.lastError ?? '' })
        return String(state?.lastError ?? '')
      }

      const reasonText = () => {
        const error = errorText()
        return error === '' ? stopText() : error
      }

      /** 档位分段按钮。 */
      const presetRow = () => {
        const presets = Array.isArray(state?.presets) ? state.presets : []
        if (presets.length === 0) return null
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'tb-presets' },
            presets.map((preset) =>
              h(
                'button',
                {
                  key: preset.key,
                  type: 'button',
                  className: 'tb-seg',
                  'data-on': state?.preset === preset.key ? '1' : '0',
                  disabled: busy !== '',
                  onClick: () => void control('preset', { preset: preset.key }),
                },
                busy === `preset:${String(preset.key)}`
                  ? t('switching')
                  : t('presetValue', { workers: preset.workers, kb: preset.fillerKb }),
              ),
            ),
          ),
          h('div', { className: 'tb-hint' }, t('presetHint')),
        )
      }

      /** 语言分段按钮：跟随系统 / 中文 / English。 */
      const localeRow = () => {
        const current = state?.locale ?? 'auto'
        const options = [
          ['auto', t('langAuto')],
          ['zh', t('langZh')],
          ['en', t('langEn')],
        ]
        return h(
          'div',
          { className: 'tb-field' },
          h('span', { className: 'tb-field__k' }, t('langRow')),
          h(
            'div',
            { className: 'tb-presets', style: { marginTop: 0 } },
            options.map(([key, text]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'tb-seg',
                  'data-on': current === key ? '1' : '0',
                  disabled: busy !== '',
                  onClick: () => void control('locale', { locale: key }),
                },
                busy === `locale:${key}` ? t('switching') : text,
              ),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'tb' },
        h(
          'h2',
          { className: 'tb-title' },
          h('span', { className: 'tb-dot', 'data-on': running ? '1' : '0', 'aria-hidden': true }),
          t('title'),
          h(
            'span',
            { style: { fontSize: 12, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' } },
            running ? t('running') : t('idle'),
          ),
        ),
        h('p', { className: 'tb-intro' }, t('intro1'), t('intro2')),

        presetRow(),
        localeRow(),
        h('div', { className: 'tb-hint' }, t('langHint')),

        h(
          'div',
          { className: 'tb-grid' },
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('total')), h('div', { className: 'tb-v' }, fmt(tokens.total))),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('rate')), h('div', { className: 'tb-v' }, t('rateValue', { value: fmt(state?.tokensPerMin ?? 0) }))),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('io')), h('div', { className: 'tb-v' }, `${fmt(tokens.input)} / ${fmt(tokens.output)}`)),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('turnsTime')), h('div', { className: 'tb-v' }, `${String(state?.turns ?? 0)} · ${clock(state?.elapsedMs)}`)),
        ),

        h(
          'div',
          { className: 'tb-rows' },
          row(t('providerModel'), `${state?.provider ?? '—'} / ${state?.model ?? '—'}`),
          row(
            t('presetRow'),
            state?.preset === 'custom'
              ? t('presetCustom', { workers: state?.workers ?? '—', kb: state?.fillerKb ?? '—' })
              : t('presetValue', { workers: state?.workers ?? '—', kb: state?.fillerKb ?? '—' }),
          ),
          row(t('lanesMax'), t('lanesMaxValue', { workers: state?.workers ?? '—', max: fmt(state?.maxTokens ?? 0) })),
          row(t('fillerRow'), Number(state?.fillerKb ?? 0) > 0 ? t('fillerValue', { kb: state.fillerKb }) : t('fillerOff')),
          row(t('autoStartRow'), state?.autoStart === true ? t('autoStartOn') : t('autoStartOff')),
          row(t('reasonRow'), reasonText()),
        ),

        err === '' ? null : h('div', { className: 'tb-err' }, err),

        h(
          'div',
          { className: 'tb-actions' },
          h(
            'button',
            { className: 'tb-btn', onClick: () => void control('start'), disabled: running || busy !== '' },
            busy === 'start' ? t('starting') : running ? t('burning') : t('start'),
          ),
          h(
            'button',
            { className: 'tb-btn tb-btn2', onClick: () => void control('stop'), disabled: !running || busy !== '' },
            busy === 'stop' ? t('stopping') : t('stop'),
          ),
          h('button', { className: 'tb-btn tb-btn2', onClick: () => void refresh(), disabled: busy !== '' }, t('refresh')),
        ),

        h('div', { className: 'tb-warn' }, t('warn'), t('warnKnobs')),
        h('div', { className: 'tb-hint' }, t('foot')),
      )
    }

    const inject = ['slots']

    /** 侧栏那一行的名字：按系统语言定，跟在页面里的覆盖无关（覆盖只影响页面内容）。 */
    function sectionLabel() {
      return STRINGS[detectClientLocale()].label
    }

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'token-burner', order: 7, label: sectionLabel },
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
    exports.STRINGS = STRINGS
    return module.exports
  },
})
