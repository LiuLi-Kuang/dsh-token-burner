/**
 * dsh-token-burner —— 客户端半边：DSH「设置」里的一节，中英双语。
 *
 * 版式（从上到下）：
 *   标题 + 状态 ｜ 操作（开始 / 停止 / 刷新）   ← 一打开就能点，不用往下找
 *   模型：提供方（按钮）+ 模型（下拉）
 *   档位：四档按钮
 *   语言：三个按钮
 *   数据：四格数字
 *   详情：几行只读信息
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
        intro: '宿主侧起 N 条 ctx.llm.stream() 循环，把 token 往外倒：返回内容全部丢弃，只记 usage。停止是即时 abort，没有队列。',
        groupModel: '模型',
        providerRow: '提供方',
        modelRow: '模型',
        modelUnknown: '（目录里没有这个模型）',
        providerEmpty: '这个提供方没有可用模型',
        groupPreset: '档位',
        groupLang: '语言',
        groupInfo: '详情',
        total: '总 token',
        rate: '速率',
        rateValue: '{value}/min',
        io: '输入 / 输出',
        turnsTime: '轮次 · 时长',
        lanesMax: '并发 · 输出上限',
        lanesMaxValue: '{workers} 路 · {max} max',
        fillerRow: '输入填充',
        fillerValue: '{kb} KB/请求',
        fillerOff: '关（纯输出流）',
        autoStartRow: '自动开烧',
        autoStartOn: '开（加载即烧）',
        autoStartOff: '关（手动）',
        reasonRow: '错误 / 停止原因',
        presetValue: '{workers} 路 × {kb}KB',
        presetCustom: '自定义 {workers} 路 × {kb}KB',
        start: '开始',
        stop: '停止',
        refresh: '刷新',
        burning: '烧着呢',
        starting: '启动中…',
        stopping: '停止中…',
        switching: '切换中…',
        presetHint: '切档会重建所有流（计数归零）；选择记在 ~/.dsh/token-burner.json，重启之后仍然生效。',
        presetExtreme: '64 路以上没有实测过：很可能先打爆本地网关。报错会退避重试，连续失败会自动全停。',
        langAuto: '跟随系统',
        langZh: '中文',
        langEn: 'English',
        langHint: '默认跟随系统；只影响这一页的文案，不影响燃烧。',
        warn: '⚠️ 真账单，没有 dry-run。输入流（填充开）烧的是便宜的输入 token，数字涨得快；输出流（填充关 + 大 maxTokens）单价贵但受生成速度限制。',
        warnKnobs: '旋钮都在插件的 cordis.patch.yml 里，改完 Host 会自动重组。',
        errHttp: '宿主接口读不到：{detail}',
        errControl: '控制失败：{detail}',
        errRejected: '操作被拒绝',
        catalogFail: '模型目录读不到：{detail}',
        stopPanel: '面板停止',
        stopDisabled: '插件已停用',
        stopSwitch: '切换到 {detail}',
        stopModelSwitch: '已切到 {detail}',
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
        intro: 'The host runs N concurrent ctx.llm.stream() loops and throws the output away — only usage is counted. Stopping aborts immediately; there is no queue.',
        groupModel: 'Model',
        providerRow: 'Provider',
        modelRow: 'Model',
        modelUnknown: '(not in the catalog)',
        providerEmpty: 'No models available for this provider',
        groupPreset: 'Preset',
        groupLang: 'Language',
        groupInfo: 'Details',
        total: 'Total tokens',
        rate: 'Rate',
        rateValue: '{value}/min',
        io: 'In / Out',
        turnsTime: 'Turns · Uptime',
        lanesMax: 'Lanes · max output',
        lanesMaxValue: '{workers} lanes · {max} max',
        fillerRow: 'Input filler',
        fillerValue: '{kb} KB/request',
        fillerOff: 'off (output only)',
        autoStartRow: 'Auto-start',
        autoStartOn: 'on (starts on load)',
        autoStartOff: 'off (manual)',
        reasonRow: 'Error / stop reason',
        presetValue: '{workers} lanes × {kb}KB',
        presetCustom: 'custom {workers} lanes × {kb}KB',
        start: 'Start',
        stop: 'Stop',
        refresh: 'Refresh',
        burning: 'Burning',
        starting: 'Starting…',
        stopping: 'Stopping…',
        switching: 'Switching…',
        presetHint: 'Switching rebuilds every lane (counters reset). The choice is saved in ~/.dsh/token-burner.json.',
        presetExtreme: 'Above 64 lanes is untested: the local gateway will likely give out first. Failures back off, and repeated failures stop everything.',
        langAuto: 'System',
        langZh: '中文',
        langEn: 'English',
        langHint: 'Follows the system by default. Only changes this page, not the burn.',
        warn: '⚠️ Real bill, no dry run. The input stream (filler on) burns cheap input tokens fast; the output stream (filler off, large maxTokens) is pricier but capped by generation speed.',
        warnKnobs: 'All knobs live in the plugin’s cordis.patch.yml; the host recomposes on save.',
        errHttp: 'Cannot reach the host: {detail}',
        errControl: 'Control failed: {detail}',
        errRejected: 'Rejected',
        catalogFail: 'Cannot load the model catalog: {detail}',
        stopPanel: 'Stopped from settings',
        stopDisabled: 'Plugin disabled',
        stopSwitch: 'Switched to {detail}',
        stopModelSwitch: 'Switched to {detail}',
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
      '.tb{max-width:780px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}',
      '.tb-head{display:flex;justify-content:space-between;align-items:center;gap:12px 16px;flex-wrap:wrap}',
      '.tb-title{margin:0;font-size:17px;font-weight:600;line-height:24px;display:flex;align-items:center;gap:8px}',
      '.tb-state{font-size:12.5px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
      '.tb-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.tb-dot[data-on="1"]{background:#ff7a2f;box-shadow:0 0 0 4px rgba(255,122,47,.18)}',
      '.tb-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}',
      '.tb-group{display:flex;flex-direction:column;gap:10px}',
      '.tb-group__title{font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}',
      '.tb-row2{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:10px 14px}',
      '.tb-row2>*{min-width:0}',
      '.tb-row2>span:first-child{color:var(--dsw-alias-label-tertiary);font-size:13px}',
      '.tb-chips{display:flex;gap:8px;flex-wrap:wrap}',
      '.tb-seg{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:999px;font-size:12.5px;height:30px;padding:0 14px;cursor:pointer;font-variant-numeric:tabular-nums;font-family:inherit}',
      '.tb-seg[data-on="1"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.tb-seg:disabled{opacity:.5;cursor:default}',
      '.tb-selectwrap{position:relative;display:flex;align-items:center;min-width:0}',
      '.tb-select{appearance:none;-webkit-appearance:none;height:32px;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;padding:0 30px 0 10px;font-family:inherit;text-overflow:ellipsis}',
      '.tb-caret{position:absolute;right:11px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--dsw-alias-label-tertiary);pointer-events:none}',
      '.tb-select:disabled{opacity:.5}',
      '.tb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.tb-card{background:rgba(127,127,127,.08);border-radius:10px;padding:10px 12px}',
      '.tb-k{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}',
      '.tb-v{font-size:16px;font-weight:600;line-height:24px;font-variant-numeric:tabular-nums}',
      '.tb-rows{display:flex;flex-direction:column}',
      '.tb-row{display:flex;justify-content:space-between;gap:12px 20px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:19px;flex-wrap:wrap}',
      '.tb-row:last-child{border-bottom:none}',
      '.tb-row__k{color:var(--dsw-alias-label-tertiary)}',
      '.tb-row__v{font-variant-numeric:tabular-nums;text-align:right}',
      '.tb-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.tb-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:8px;font-size:13px;height:32px;padding:0 16px;cursor:pointer;font-family:inherit}',
      '.tb-btn:disabled{opacity:.5;cursor:default}',
      '.tb-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.tb-err{color:var(--dsw-alias-state-error-primary);font-size:12.5px;line-height:18px;white-space:pre-line}',
      '.tb-warn{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);background:rgba(226,86,31,.10);border-radius:8px;padding:10px 12px}',
      '.tb-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.tb-hint[data-warn="1"]{color:#c2410c}',
      '.tb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
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
        h('span', { className: 'tb-row__v' }, value),
      )

    /** 一颗分段按钮。 */
    const seg = (key, on, label, disabled, onClick, title) =>
      h(
        'button',
        {
          key,
          type: 'button',
          className: 'tb-seg',
          'data-on': on ? '1' : '0',
          disabled,
          onClick,
          ...(title === undefined ? {} : { title }),
        },
        label,
      )

    function TokenBurnerSection() {
      useStyleOnce()
      const [state, setState] = useState(null)
      const [catalog, setCatalog] = useState(null)
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
        } catch (error) {
          if (!alive.current) return
          setErr(makeT(detectClientLocale())('errHttp', { detail: String(error?.message ?? error) }))
        }
      }, [])

      const loadCatalog = useCallback(async () => {
        try {
          const response = await fetch(`${API}/catalog`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const next = await response.json()
          if (!alive.current || next?.ok !== true) return
          setCatalog(next)
        } catch (error) {
          if (alive.current) {
            setErr(makeT(detectClientLocale())('catalogFail', { detail: String(error?.message ?? error) }))
          }
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void refresh()
        void loadCatalog()
        // 状态 1.5 秒一刷；目录 30 秒一刷（宿主那边也是 30 秒缓存）。
        // 提供方列表是向宿主现查的，不是写死在插件里的。
        const timer = setInterval(() => void refresh(), 1500)
        const catalogTimer = setInterval(() => void loadCatalog(), 30000)
        return () => {
          alive.current = false
          clearInterval(timer)
          clearInterval(catalogTimer)
        }
      }, [refresh, loadCatalog])

      const control = async (action, payload) => {
        const busyKey =
          action === 'preset'
            ? `preset:${String(payload?.preset ?? '')}`
            : action === 'locale'
              ? `locale:${String(payload?.locale ?? '')}`
              : action === 'model'
                ? 'model'
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
        if (action === 'model') await loadCatalog()
      }

      const running = state?.running === true
      const tokens = state?.tokens ?? {}
      const working = busy !== ''

      // ── 模型 ──
      const providerId = String(state?.provider ?? '')
      const modelId = String(state?.model ?? '')
      const providers = Array.isArray(catalog?.providers) ? catalog.providers : []
      const currentProvider = providers.find((item) => item.id === providerId)
      const models = Array.isArray(currentProvider?.models) ? currentProvider.models : []

      /** 点提供方：同一模型 id 在新提供方下也有就保留，否则取它的第一个模型。 */
      const pickProvider = (id) => {
        const target = providers.find((item) => item.id === id)
        if (target === undefined || target.models.length === 0) return
        const same = target.models.find((item) => item.id === modelId)
        void control('model', { provider: id, model: (same ?? target.models[0]).id })
      }

      const modelGroup = () =>
        h(
          'div',
          { className: 'tb-group' },
          h('div', { className: 'tb-group__title' }, t('groupModel')),
          h(
            'div',
            { className: 'tb-row2' },
            h('span', null, t('providerRow')),
            h(
              'div',
              { className: 'tb-chips' },
              providers.length === 0
                ? h('span', { className: 'tb-hint tb-mono' }, providerId || '—')
                : providers.map((item) =>
                    seg(
                      item.id,
                      item.id === providerId,
                      item.name,
                      working || item.models.length === 0,
                      () => pickProvider(item.id),
                      item.models.length === 0 ? t('providerEmpty') : undefined,
                    ),
                  ),
            ),
            h('span', null, t('modelRow')),
            h(
              'div',
              null,
              models.length === 0
                ? h('span', { className: 'tb-hint tb-mono' }, modelId || '—')
                : h(
                    'div',
                    { className: 'tb-selectwrap' },
                    h(
                      'select',
                      {
                        className: 'tb-select tb-mono',
                        value: modelId,
                        disabled: working,
                        onChange: (event) => void control('model', { provider: providerId, model: event.target.value }),
                      },
                      models.map((item) =>
                        h('option', { key: item.id, value: item.id }, item.id === modelId ? item.id : `${item.id}  ·  ${item.name}`),
                      ),
                      modelId !== '' && models.every((item) => item.id !== modelId)
                        ? h('option', { value: modelId }, `${modelId} ${t('modelUnknown')}`)
                        : null,
                    ),
                    h('span', { className: 'tb-caret', 'aria-hidden': true }),
                  ),
            ),
          ),
        )

      // ── 档位 ──
      const presetKey = String(state?.preset ?? '')
      const presets = Array.isArray(state?.presets) ? state.presets : []
      const extreme = presetKey === 'ultra' || presetKey === 'extreme'

      const presetGroup = () =>
        h(
          'div',
          { className: 'tb-group' },
          h('div', { className: 'tb-group__title' }, t('groupPreset')),
          presets.length === 0
            ? h('span', { className: 'tb-hint' }, t('presetCustom', { workers: state?.workers ?? '—', kb: state?.fillerKb ?? '—' }))
            : h(
                'div',
                { className: 'tb-chips' },
                presets.map((preset) =>
                  seg(
                    preset.key,
                    preset.key === presetKey,
                    busy === `preset:${String(preset.key)}` ? t('switching') : t('presetValue', { workers: preset.workers, kb: preset.fillerKb }),
                    working,
                    () => void control('preset', { preset: preset.key }),
                  ),
                ),
              ),
          presetKey === 'custom'
            ? h('div', { className: 'tb-hint' }, t('presetCustom', { workers: state?.workers ?? '—', kb: state?.fillerKb ?? '—' }))
            : null,
          h('div', { className: 'tb-hint' }, t('presetHint')),
          extreme ? h('div', { className: 'tb-hint', 'data-warn': '1' }, t('presetExtreme')) : null,
        )

      // ── 语言 ──
      const localeNow = state?.locale ?? 'auto'
      const localeGroup = () =>
        h(
          'div',
          { className: 'tb-group' },
          h('div', { className: 'tb-group__title' }, t('groupLang')),
          h(
            'div',
            { className: 'tb-chips' },
            [
              ['auto', t('langAuto')],
              ['zh', t('langZh')],
              ['en', t('langEn')],
            ].map(([key, text]) =>
              seg(
                key,
                localeNow === key,
                busy === `locale:${key}` ? t('switching') : text,
                working,
                () => void control('locale', { locale: key }),
              ),
            ),
          ),
          h('div', { className: 'tb-hint' }, t('langHint')),
        )

      // ── 把 stopCode + detail 翻成本地文案（宿主只说代码，语言由这里定） ──
      const reasonText = () => {
        const code = String(state?.stopCode ?? '')
        const detail = String(state?.stopDetail ?? '')
        if (state?.lastErrorCode === 'model-unavailable') return t('stopModel', { detail: state?.lastError ?? '' })
        if (state?.lastErrorCode === 'lane-error') return t('stopLane', { detail: state?.lastError ?? '' })
        if (code === '') return '—'
        if (code === 'preset-switch') {
          const preset = presets.find((item) => item.key === detail)
          return t('stopSwitch', {
            detail: preset === undefined ? detail : t('presetValue', { workers: preset.workers, kb: preset.fillerKb }),
          })
        }
        const byCode = {
          panel: 'stopPanel',
          'plugin-disabled': 'stopDisabled',
          'model-switch': 'stopModelSwitch',
          fatal: 'stopFatal',
          'too-many-errors': 'stopTooMany',
          'model-unavailable': 'stopModel',
          manual: 'stopManual',
        }
        return byCode[code] === undefined ? `${code}: ${detail}` : t(byCode[code], { detail })
      }

      return h(
        'div',
        { className: 'tb' },
        // 标题 + 状态 ｜ 操作
        h(
          'div',
          { className: 'tb-head' },
          h(
            'h2',
            { className: 'tb-title' },
            h('span', { className: 'tb-dot', 'data-on': running ? '1' : '0', 'aria-hidden': true }),
            t('title'),
            h('span', { className: 'tb-state' }, running ? t('running') : t('idle')),
          ),
          h(
            'div',
            { className: 'tb-actions' },
            h(
              'button',
              { className: 'tb-btn', onClick: () => void control('start'), disabled: running || working },
              busy === 'start' ? t('starting') : running ? t('burning') : t('start'),
            ),
            h(
              'button',
              { className: 'tb-btn tb-btn2', onClick: () => void control('stop'), disabled: !running || working },
              busy === 'stop' ? t('stopping') : t('stop'),
            ),
            h('button', { className: 'tb-btn tb-btn2', onClick: () => void Promise.all([refresh(), loadCatalog()]), disabled: working }, t('refresh')),
          ),
        ),
        h('p', { className: 'tb-intro' }, t('intro')),
        modelGroup(),
        presetGroup(),
        localeGroup(),

        // 数据
        h(
          'div',
          { className: 'tb-grid' },
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('total')), h('div', { className: 'tb-v' }, fmt(tokens.total))),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('rate')), h('div', { className: 'tb-v' }, t('rateValue', { value: fmt(state?.tokensPerMin ?? 0) }))),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('io')), h('div', { className: 'tb-v' }, `${fmt(tokens.input)} / ${fmt(tokens.output)}`)),
          h('div', { className: 'tb-card' }, h('div', { className: 'tb-k' }, t('turnsTime')), h('div', { className: 'tb-v' }, `${String(state?.turns ?? 0)} · ${clock(state?.elapsedMs)}`)),
        ),

        // 详情
        h(
          'div',
          { className: 'tb-group' },
          h('div', { className: 'tb-group__title' }, t('groupInfo')),
          h(
            'div',
            { className: 'tb-rows' },
            row(t('lanesMax'), t('lanesMaxValue', { workers: state?.workers ?? '—', max: fmt(state?.maxTokens ?? 0) })),
            row(t('fillerRow'), Number(state?.fillerKb ?? 0) > 0 ? t('fillerValue', { kb: state.fillerKb }) : t('fillerOff')),
            row(t('autoStartRow'), state?.autoStart === true ? t('autoStartOn') : t('autoStartOff')),
            row(t('reasonRow'), reasonText()),
          ),
        ),

        err === '' ? null : h('div', { className: 'tb-err' }, err),
        h('div', { className: 'tb-warn' }, t('warn'), t('warnKnobs')),
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
