# dsh-token-burner

**中文** | [English](README.en.md)

[![test](https://github.com/LiuLi-Kuang/dsh-token-burner/actions/workflows/test.yml/badge.svg)](https://github.com/LiuLi-Kuang/dsh-token-burner/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/LiuLi-Kuang/dsh-token-burner)](https://github.com/LiuLi-Kuang/dsh-token-burner/releases/latest)

> A DSH plugin that burns API tokens on purpose. It stays idle until you press Start, stops instantly when you tell it to, and shows the rate in **Settings → Token 燃烧器**.
>
> Why open source: it is a small, complete example of two DSH plugin patterns — a host half driven by `ctx.llm.stream()` with `AbortSignal`, and a client half mounted through `settings.section` — that are hard to get right from the docs alone.

---

## 它是什么

一个故意消耗 token 的 DSH 插件：

- **宿主半边**（`entry.js`）用 `ctx.llm.stream()` 起 N 条并发流，把返回的内容全部丢掉，只把 `usage` 分片里的 token 数记下来；
- **客户端半边**（`client.js`）在 DSH 的「设置」里挂一节，显示速率并给出开始/停止；
- **加载不等于开烧**：装好、开机、profile 重组都不会自动跑；去设置页点「开始」才烧。被停用 = 立刻 abort，**没有队列**，所以停了就是真的停了。

## ⚠️ 先读这段

- **这是真账单。** 没有 dry-run、没有假模型、没有额度上限。默认档实测约 **6.5M token/分钟**，一小时近 4 亿。
- **别对不属于你的账号、共享网关或生产环境用。** 持续高速刷量很可能触发服务商的限流或风控，也可能违反其服务条款。后果自负。
- 这个仓库的意义是「一个能跑通的例子」，不是「一个刷量工具」。你想看的是它里面那几个 API 的用法，不是那个数字。

## 兼容性

在 **DSH NEXT 桌面端**（`deepseek-harness`，2026-11 的 profile 结构）上开发和实测。用到的接口：

| 接口 | 用途 |
|---|---|
| `ctx.llm.stream({ provider, model, messages, maxTokens, signal })` | 发请求；产出 `text-delta` / `usage` / `finish` 分片 |
| `ctx.llm.resolveModelInfo(provider, model)` | 启动前校验模型是否存在；切模型时也靠它拦非法值 |
| `ctx.llm.listProviders()` + `ctx.llm.listModels(provider)` | 设置页「提供方 / 模型」按钮的数据源 |
| `ctx.get('agentDefaultModel').currentSelection()` | 没配置模型时，问宿主要 profile 的默认模型 |
| `ctx.webServer.register({ kind: 'exact', path, handler })` | 设置页读写的七个 HTTP 端点 |
| `ctx.get('connection').requestRejection(req)` | 信任栅栏（Host/Origin + 浏览器登录态） |
| `ctx.effect(() => cleanup)` | 停用时熄火 |
| `ctx.slots.inject('settings.section')` + `ctx.slots.register(...)` | 挂设置节 |

## 安装

插件按 `link:` 依赖装进 profile（改文件即生效，不用重装）：

```bash
git clone https://github.com/LiuLi-Kuang/dsh-token-burner.git
cd ~/.dsh/profiles/desktop
pnpm add "link:C:/path/to/dsh-token-burner"
```

然后把 `dsh-token-burner` 加进该 profile `package.json` 的 `dsh.profile.bundles`：

```json
"bundles": ["@deepseek-ai/dsh-base", "...", "dsh-token-burner"]
```

插件包自带的 `dsh.bundle.patch`（`cordis.patch.yml`）会把配置行插进组合树，所以不用手改 profile 的 patch。

桌面端的 Host 会热重组：改完 profile 几十毫秒内日志里就能看到 `开烧` / `熄火`，已打开的页面也会跟着模块图把设置节挂上。

## 配置

全在包的 `cordis.patch.yml` 里（`insert` 那一行的 `config`）：

| 键 | 默认 | 说明 |
|---|---:|---|
| `autoStart` | `false` | 只有显式写 `true` 才会加载即开烧；缺省一律当「不烧」。**默认关**，打开 DSH 不会自己跑 |
| `provider` | 空 | 提供方不是固定值：**留空 = 跟随 profile 里的默认模型**（`agent-default-model`），启动时向宿主现查；设置页里是一排按钮，选项来自宿主的 `listProviders()`
| `model` | 空 | 模型不是固定值：**留空 = 跟随 profile 里的默认模型**；设置页里是下拉，选项是当前提供方在宿主目录里的全部模型，切换前用 `resolveModelInfo` 校验
| `locale` | `auto` | 界面语言：`auto` 跟随系统（zh 系才中文，其余英文）/ `zh` / `en`。设置页里也能改，记在 `~/.dsh/token-burner.json` |
| `preset` | `max` | 档位：`high` = 8 路 × 32KB，`max` = 16 路 × 64KB（默认），`ultra` = 64 路 × 128KB，`extreme` = 128 路 × 256KB。设置页那组按钮切的就是它
| `maxTokens` | `128` | 单次输出上限 |
| `gapMs` | `0` | 两轮之间歇多久 |
| `workers` / `fillerKb` | — | 只有 `preset` 缺省时才生效（自定义档），平时由档位决定 |
| `reasoningEffort` | 空 | `low` / `high` / `max`，会额外产生 reasoning token |
| `system` / `prompt` | 内置 | `{nonce}` 会替换成随机串 |

## 界面

「设置 → Token 燃烧器」里是一节（`settings.section`，不是浮窗）。从上到下：

| 区块 | 内容 |
|---|---|
| **标题 + 操作** | 状态点和「燃烧中 / 已停止」在左，开始 / 停止 / 刷新在右——一打开就能点，不用往下找 |
| **模型** | 提供方是一排按钮，**选项是向宿主现查的**（`listProviders()`），每 30 秒和点「刷新」时重查；没有可用模型的提供方会置灰。模型是下拉，列当前提供方的全部模型 |
| **档位** | 四档按钮：`8 路 × 32KB` / `16 路 × 64KB`（默认）/ `64 路 × 128KB` / `128 路 × 256KB`，点了立刻重建所有流（计数归零） |
| **语言** | `跟随系统` / `中文` / `English`，默认跟随系统，切换只影响这一页文案 |
| **数据** | 2×2 四格：总 token / 速率 / 输入·输出 / 轮次·时长 |
| **详情** | 并发·输出上限、输入填充、自动开烧、错误 / 停止原因 |

这几项选择（模型、档位、语言）都写到 `~/.dsh/token-burner.json`——插件不回头去改 profile 的 `cordis.patch.yml`（那是宿主的部署配置），删掉这个文件就回到 patch 里的值。

切模型和切档一样，运行中点下去会先熄火再按新参数点火；模型不存在会被直接拒绝，不动现有配置。保存过的路由如果失效了（换过机器、提供方被删），开烧时会自动退回 profile 的默认模型。

## 两种烧法（实测）

生成 token 有硬天花板：单路 40–120 token/s，8 路加起来也就 300 出头，**加路数几乎不涨**。所以真要快，得烧输入侧——prefill 是并行吞吐，比逐 token 生成快一个量级。

| 模式 | 配置 | 实测 |
|---|---|---|
| 输出流（贵、慢） | `fillerKb: 0`、`maxTokens: 16384`、长文提示 | 2 路 173s / 41,956 token ≈ **14.5k/min**；8 路仍只有 **19k/min** |
| 输入流（便宜、快） | `fillerKb: 16`、`maxTokens: 128`、只回两个字 | 4 路 97s / 1,184,506 token ≈ **732k/min** |
| 输入流 8×32 | `preset: high` | 66s / 2,797,144 token ≈ **2.54M/min**，零报错 |
| 输入流 16×64（默认） | `preset: max` | 92s / 9,972,285 token ≈ **6.5M/min**，零报错 |

输入流里 99% 是输入 token（单价便宜）；输出流反之，但被生成速度卡死。

## 三个「开」/ 三个「关」

| 开 | 关 |
|---|---|
| 设置页「开始」 ← 正常入口 | 设置页「停止」→ `running=false` + `abort()` |
| 插件页启用（只是把插件装回组合树） | 插件页停用 → dispose：先熄火再拆路由 |
| 改 `autoStart: true`（开机即烧，慎用） | 改回 `false`，或卸载依赖 |

「关闭就会停止」靠**没有队列**：每轮都是「一条流跑完 → 记数 → 下一轮」，从不往某个队列里塞消息，所以停下之后不存在“还有几十条排着队继续烧”。

## 设计笔记

### 为什么用 `ctx.llm.stream` 而不是 `sessionController.prompt`

`prompt()` 把消息塞进 Agent 的 inbox 就返回 `{ accepted: true }`：既拿不到“这一轮烧了多少”，停插件时也没法确认 inbox 已经空了——队列里剩的消息会在“关掉”之后继续跑。`ctx.llm.stream()` 是同步流 + `AbortSignal`，abort 之后一条新请求都不会发，流末尾的 `usage` 分片还是 provider 计费的原始数字。

代价：这些调用不落在任何会话日志里，所以 DSH 自己的用量统计看不到它们，数字只在设置页那一节里。

### 为什么每条消息都带随机 stamp

同一条提示反复发会命中 provider 的 prompt cache（缓存命中价通常只有 1/10），那就不是在“消耗”了。每条消息的第一个 token 就是随机 stamp，前缀永远分叉，按全价计费。

### 为什么填充文本可以是一段固定的话

缓存匹配的是**前缀**。stamp 在第一位，后面哪怕是一模一样的十万字，也已经从第一个 token 就分叉了。

### 停用时的清理

```js
ctx.effect(() => () => {
  void burner.stop('plugin-disabled')   // abort 是同步生效的
  for (const dispose of disposers) dispose()
})
```

`stop()` 先关闸（`running = false`）再 `abort()`，然后最多等 3 秒让流收尾。没有队列，所以返回之后不会再有任何新请求。

## 安全

- 七个 HTTP 端点只对本机回环开放，并且过 `connection.requestRejection` 的信任栅栏（fail-closed）：端口万一被绑到 `0.0.0.0`，局域网里的页面也点不动它。
- 设置节里的数字全部来自宿主，客户端不缓存、不推断。
- 没有把 provider 的 key 读进插件：用的是 profile 里已配好的路由。

## 自测

```bash
npm test
```

五个测试，全部离线（假 ctx + 假模型流，不联网、不产生任何账单）：

| 测试 | 盖住什么 |
|---|---|
| `tests/selftest.test.mjs` | 开 → 烧 → 停 → 真停 → 换档 |
| `tests/section.test.mjs` | loader id / `inject` / `settings.section` 注册点 / 中英两张文案表 key 一致；再用桩子把组件渲一遍（空状态、满状态：5 提供方 · 25 模型 · 四档） |
| `tests/no-autostart.test.mjs` | `{}`、`"true"`、`false` 都不开烧 |
| `tests/locale.test.mjs` | `auto` 解析、`zh`/`en` 覆盖、落盘、非法值拒绝、停止原因是代码 |
| `tests/model.test.mjs` | 跟随宿主默认模型、模型目录、切模型、落盘、拒绝非法模型、失效路由自动退回、四档预设、128 路起停（混入瞬时错误也不会被误停） |

CI 在 Node 22 / 24 上跑同一套。

## 已知边界

- 如果某个 provider 不回 `usage` 分片，设置页的 token 会一直是 0（但账单照收）。
- **16 路是实测过的上限**（92 秒 997 万 token，零失败）。`ultra`（64 路）和 `extreme`（128 路）**没有拿真 token 实测过**，只在假模型下验证了能起能停——很可能先打爆本地网关，设置页里选到它们会带一条未实测提示。
- 失败按「这一路连续失败几次」指数退避；只有所有路中间没有任何成功、累计失败数达到并发数的两倍（至少 12）才会自动全停。额度/凭据类错误直接全停。
- 实测环境是 Windows + 本地网关，其他环境的速率会不一样。

## 变更

- **0.3.0** — 提供方和模型不再是固定值：**留空即跟随 profile 的默认模型**（启动时向宿主现查，保存过的路由失效时也自动退回）。设置页新增**提供方按钮 + 模型下拉**，选项同样向宿主现查；档位从两档加到**四档**（+64 路 × 128KB、+128 路 × 256KB，这两档未拿真 token 实测）。设置页重排：操作按钮提到顶部，内容分成「模型 / 档位 / 语言 / 数据 / 详情」。修了一个真问题：退避和「连续失败全停」以前按全局累计错误数算，高并发下偶发几个瞬时错误就会被误停，现在按每一路自己的连续失败算。
- **0.2.0** — 中英双语。语言默认跟随系统（`auto`：zh 系给中文，其余英文），设置页可切 `跟随系统 / 中文 / English`，选择写进 `~/.dsh/token-burner.json`。宿主侧把停止原因从句子改成了代码（`panel` / `plugin-disabled` / `preset-switch` / `fatal` / `too-many-errors` / `model-unavailable`），文案由客户端按语言翻。
- **0.1.1** — 修掉「开机自启」。`autoStart` 默认改为 `false`，并且只有**显式写 `true`** 才算开：缺省、拼错、这行被删掉，一律当不烧。0.1.0 里默认是开，2026-11-24 那次开机自启在 92 秒内烧掉了 15,061,579 token。
- **0.1.0** — 首个版本：两档预设（16×64 默认 / 8×32）、设置页开关与实时速率、CI。

## License

MIT，见 [LICENSE](LICENSE)。
