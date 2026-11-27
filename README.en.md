# dsh-token-burner

[中文](README.md) | **English**

[![test](https://github.com/LiuLi-Kuang/dsh-token-burner/actions/workflows/test.yml/badge.svg)](https://github.com/LiuLi-Kuang/dsh-token-burner/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/LiuLi-Kuang/dsh-token-burner)](https://github.com/LiuLi-Kuang/dsh-token-burner/releases/latest)

> A DSH plugin that burns API tokens on purpose. It stays idle until you press Start, stops instantly when you tell it to, and shows the rate in **Settings → Token Burner**.
>
> Why open source: it is a small, complete example of two DSH plugin patterns — a host half driven by `ctx.llm.stream()` with `AbortSignal`, and a client half mounted through `settings.section` — that are hard to get right from the docs alone.

---

## What it is

- **Host half** (`entry.js`): runs N concurrent `ctx.llm.stream()` loops, throws every response away, and counts only the `usage` chunks.
- **Client half** (`client.js`): a section under **Settings**, bilingual (Chinese / English), with start/stop and a live rate readout.
- Loading the plugin does **not** start a burn. You start it explicitly. Disabling the plugin aborts immediately — there is no queue, so stopping really stops.

## ⚠️ Read this first

- **This is a real bill.** No dry run, no fake models, no budget cap. The default preset measures around **6.5M tokens/minute** — roughly 400M an hour.
- **Don't point it at accounts, shared gateways or production you don't own.** Sustained high-rate traffic may trip rate limits or abuse detection, and may violate the provider's terms.
- The point of this repo is the patterns, not the number.

## Compatibility

Built and measured against **DSH NEXT for desktop** (`deepseek-harness`, profile layout as of 2026-11). APIs used:

| API | Purpose |
|---|---|
| `ctx.llm.stream({ provider, model, messages, maxTokens, signal })` | issue a request; yields `text-delta` / `usage` / `finish` chunks |
| `ctx.llm.resolveModelInfo(provider, model)` | validate the model before starting, and on every switch |
| `ctx.llm.listProviders()` + `ctx.llm.listModels(provider)` | where the Provider / Model controls get their options |
| `ctx.get('agentDefaultModel').currentSelection()` | the profile's default model, asked for when none is configured |
| `ctx.webServer.register({ kind: 'exact', path, handler })` | the seven HTTP endpoints the UI talks to |
| `ctx.get('connection').requestRejection(req)` | trust fence (Host/Origin + browser login) |
| `ctx.effect(() => cleanup)` | abort on dispose |
| `ctx.slots.inject('settings.section')` + `ctx.slots.register(...)` | mount the settings section |

## Install

The plugin is installed into the profile as a `link:` dependency, so editing files takes effect without reinstalling:

```bash
git clone https://github.com/LiuLi-Kuang/dsh-token-burner.git
cd ~/.dsh/profiles/desktop
pnpm add "link:C:/path/to/dsh-token-burner"
```

Then add `dsh-token-burner` to that profile's `dsh.profile.bundles` in `package.json`:

```json
"bundles": ["@deepseek-ai/dsh-base", "...", "dsh-token-burner"]
```

The package ships a `dsh.bundle.patch` (`cordis.patch.yml`), so you don't need to edit the profile patch by hand.

The desktop host recomposes on profile changes: within a few dozen milliseconds the log shows either `开烧` or `已挂载，autoStart=false`, and an already-open page picks the section up through the module graph.

## Configuration

Everything lives in the package's `cordis.patch.yml` (the `config` of the `insert` row):

| Key | Default | Meaning |
|---|---:|---|
| `autoStart` | `false` | Only a literal `true` starts a burn on load. Anything else means idle |
| `locale` | `auto` | UI language: `auto` follows the system (zh → Chinese, else English), or `zh` / `en` |
| `provider` | empty | not a fixed value: **empty = follow the profile's default model** (`agent-default-model`), asked from the host at load; a row of buttons in Settings, options from the host's `listProviders()`
| `model` | empty | not a fixed value: **empty = follow the profile's default model**; a dropdown in Settings listing the current provider's models from the host catalog, validated with `resolveModelInfo` on every switch
| `preset` | `max` | `high` = 8 lanes × 32KB, `max` = 16 lanes × 64KB (default), `ultra` = 64 lanes × 128KB, `extreme` = 128 lanes × 256KB
| `maxTokens` | `128` | per-request output cap |
| `gapMs` | `0` | pause between turns |
| `workers` / `fillerKb` | — | only used when `preset` is absent (custom tuning) |
| `reasoningEffort` | empty | `low` / `high` / `max` adds reasoning tokens |
| `system` / `prompt` | built in | `{nonce}` is replaced with a random string |

## UI

One section under **Settings → Token Burner** (a `settings.section`, not a floating window), top to bottom:

| Block | What |
|---|---|
| **Title + actions** | status dot and “Burning / Idle” on the left, Start / Stop / Refresh on the right — reachable as soon as the page opens |
| **Model** | Provider as a row of buttons, **queried from the host** (`listProviders()`), refreshed every 30s and on Refresh; providers with no usable model are greyed out. Model as a dropdown listing every model of the current provider |
| **Preset** | four buttons: `8 lanes × 32KB` / `16 lanes × 64KB` (default) / `64 lanes × 128KB` / `128 lanes × 256KB`; switching rebuilds every stream (counters reset) |
| **Language** | `System` / `中文` / `English`, following the system by default |
| **Data** | a 2×2 grid: total tokens, rate, in/out, turns · uptime |
| **Details** | lanes·max output, input filler, auto-start, error / stop reason |

All three choices (model, preset, language) are written to `~/.dsh/token-burner.json` — the plugin never rewrites the profile's `cordis.patch.yml`. Delete that file to fall back to the values in the patch.

Switching the model behaves like switching presets: if it is burning, it stops first and restarts on the new route. An unknown model is rejected and the current config is left untouched. If a saved route has gone stale (different machine, provider removed), starting falls back to the profile's default model.

## Two ways to burn (measured)

Token generation has a hard ceiling: 40–120 tokens/s per stream, and eight streams only reach ~300/s in aggregate — **adding lanes barely helps**. So real speed comes from the input side: prefill is parallel throughput, an order of magnitude faster than token-by-token generation.

| Mode | Config | Measured |
|---|---|---|
| Output stream (expensive, slow) | `fillerKb: 0`, `maxTokens: 16384`, long-form prompt | 2 lanes, 173s → 41,956 tokens ≈ **14.5k/min**; 8 lanes still ≈ **19k/min** |
| Input stream (cheap, fast) | `preset: high` (8 × 32KB) | 66s → 2,797,144 tokens ≈ **2.54M/min**, zero errors |
| Input stream, max (default) | `preset: max` (16 × 64KB) | 92s → 9,972,285 tokens ≈ **6.5M/min**, zero errors |

In the input-stream modes ~99% of the tokens are input tokens (cheaper per token); the output mode is the opposite but capped by generation speed.

## Start / stop

| Start | Stop |
|---|---|
| **Settings → Start** (the normal way) | Settings → Stop → `running=false` + `abort()` |
| Enabling the plugin (only re-adds it to the tree) | Disabling the plugin → dispose: abort first, then unroute |
| `autoStart: true` (burn on load — use deliberately) | Set it back to `false`, or uninstall |

“Stop means stop” comes from having **no queue**: every turn is “one stream finishes → count → next”, nothing is ever piled into an inbox, so nothing keeps running after you stop.

## Design notes

### Why `ctx.llm.stream` instead of `sessionController.prompt`

`prompt()` drops the message into the agent's inbox and returns `{ accepted: true }`: you can't tell how many tokens that turn burned, and on disable you can't confirm the inbox is empty — leftover messages keep running after “stop”. `ctx.llm.stream()` is a synchronous stream plus an `AbortSignal`; after abort no new request is issued, and the trailing `usage` chunk carries the provider's own numbers.

The trade-off: these calls never land in a session log, so DSH's own usage accounting doesn't see them. The numbers live only in the settings section.

### Why every message carries a random stamp

Repeating the same prompt hits the provider's prompt cache (usually 1/10 the price), which is not “burning”. Every message starts with a random stamp, so the prefix diverges at token one and is billed in full.

### Why the filler text can be a fixed string

Cache matching is prefix-based. The stamp is first, so even an identical 100k characters after it is a fresh prefix.

### Cleanup on dispose

```js
ctx.effect(() => () => {
  void burner.stop('plugin-disabled')   // abort takes effect synchronously
  for (const dispose of disposers) dispose()
})
```

`stop()` closes the gate first (`running = false`), then aborts, then waits at most 3 seconds for streams to unwind. No queue, so nothing new is issued after it returns.

## Security

- The seven endpoints only answer loopback requests and pass through `connection.requestRejection` (fail-closed): if the port ever binds to `0.0.0.0`, pages on the LAN still can't drive it.
- Everything the section shows comes from the host; the client doesn't cache or infer.
- The plugin never reads provider keys: it uses the route already configured in the profile.

## Tests

```bash
npm test
```

Five offline tests (fake ctx, fake model stream — no network, no bill):

| Test | Covers |
|---|---|
| `tests/selftest.test.mjs` | start → burn → stop → really stopped → preset switch |
| `tests/section.test.mjs` | loader id / `inject` / `settings.section` registration / zh-en key parity; also renders the component with stubs (empty state, full state: 5 providers · 25 models · four presets) |
| `tests/no-autostart.test.mjs` | `{}`, `"true"` and `false` all mean idle |
| `tests/locale.test.mjs` | `auto` resolution, `zh`/`en` override, persistence, invalid values rejected, stop reason is a code |
| `tests/model.test.mjs` | follows the host default model, catalog, switching, persistence, invalid model rejected, stale route falls back, four presets, 128 lanes start/stop (transient errors don't trip the kill switch) |

CI runs them on Node 22 and 24.

## Known limits

- If a provider never emits a `usage` chunk, the token counter stays at 0 (the bill doesn't).
- **16 lanes is the highest measured preset** (92s, 9.97M tokens, zero failures). `ultra` (64 lanes) and `extreme` (128 lanes) have **not been measured against a real provider** — only started and stopped against a fake model. Expect the local gateway to give out first; the UI shows an “untested” hint when either is selected.
- Backoff is exponential per lane, based on that lane’s own consecutive failures. Everything stops only when no lane has succeeded for `2 × workers` failures (at least 12). Quota/credential errors stop everything at once.
- Measured on Windows against a local gateway; rates will differ elsewhere.

## Changelog

- **0.3.0** — Provider and model are no longer fixed values: **empty means follow the profile's default model** (asked from the host at load; a stale saved route falls back to it too). New **provider buttons + model dropdown** in Settings, also queried from the host. Presets went from two to **four** (+64 lanes × 128KB, +128 lanes × 256KB — neither measured against a real provider). Settings page restructured: actions moved to the top, content grouped into Model / Preset / Language / Data / Details. Fixed a real bug: backoff and the “too many errors” kill switch used the global error count, so a few transient errors at high concurrency stopped everything; both are now per lane.
- **0.2.0** — Bilingual UI. Language defaults to the system (`auto`: zh → Chinese, otherwise English), switchable in Settings, persisted in `~/.dsh/token-burner.json`. The host now returns stop *codes* (`panel` / `plugin-disabled` / `preset-switch` / `fatal` / `too-many-errors` / `model-unavailable`) and the client translates them.
- **0.1.1** — Fixes “starts on boot”. `autoStart` now defaults to `false` and only a literal `true` counts. 0.1.0 defaulted to on; one boot on 2026-11-24 burned 15,061,579 tokens in 92 seconds.
- **0.1.0** — First release: two presets (16×64 default / 8×32), Settings switch and live rate, CI.

## License

MIT — see [LICENSE](LICENSE).
