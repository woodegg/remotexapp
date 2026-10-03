# RemoteXApp Service 设计草案

> Implementation update: the current PoC now separates file-managed
> `RemoteXAppTemplate`, API-managed persistent registrations, and generated
> runtime instances. The authoritative implemented contract is
> [template-managed-instance-design.md](template-managed-instance-design.md).
> Managed and anonymous runtime persistence, restart adoption, and locked
> recovery are specified in
> [runtime-manifest-design.md](runtime-manifest-design.md). Immutable driver
> publication, same-manager failure recovery, and update semantics are in
> [driver-version-lifecycle.md](driver-version-lifecycle.md). Traceable status
> and decisions are maintained in [requirements.md](requirements.md) and
> [design-log.md](design-log.md).
> The older `SessionClass` terminology below is retained as design history.

## 目标

在 sandbox 中提供一个统一的服务，用于启动、托管并向浏览器交付独立的 X11 应用实例。

同一服务必须同时支持：

- 一个完整的、可共享的 XFCE remote desktop；
- 一个单应用 kiosk，例如 WeChat、LibreOffice Impress 或浏览器；
- 多个具有独立 profile/HOME 的同类应用实例；
- 长期运行、手动启动、以及无人连接后自动回收的临时实例。

服务不是“微信服务”或“XFCE 服务”。它是一个 **X11 session factory**：通过 class 配置选择一个 display 里运行的 session 和应用。

```text
一个 RemoteXApp Server
  + 不同 SessionClass
  = XFCE desktop / WeChat / Impress kiosk / 其他受支持 X11 app
```

### 分阶段范围

第一阶段是**本地 PoC**，不依赖 WAOS、Cloudflare Access、外部认证或跨 host 调度：

```text
local browser client ↔ local RemoteXApp Manager ↔ local per-instance runtimes
```

它的目的不是先解决公开访问，而是证明一个服务可以以同一套 API、class 和 lifecycle 同时创建 XFCE desktop 与单应用 Matchbox session。第二阶段才把 WAOS 作为外部认证和 reverse-proxy adapter 接入，不能反过来让 WAOS 阻塞第一阶段。

## 证据基础与范围

本设计以本项目的 TigerVNC/noVNC/Go/IBus POC 为基础。已验证的事实、输入法问题及测试限制见：

- [production handover](production-handover.md)
- [lessons learned](novnc-impress-lessons.md)

以下事实已经验证：

- TigerVNC loopback RFB + Go WebSocket/RFB relay + noVNC 浏览器客户端可工作；
- 浏览器的鼠标、滚轮、导航键和快捷键应走原生 RFB；
- 已提交的浏览器 IME Unicode 文本可经私有 IBus Unix socket 交给 GTK 和 LibreOffice；
- 每个独立账号/租户必须使用独立 X display、IBus runtime/socket 与 HOME/profile；
- Matchbox 适合单应用 canvas；XFCE 适合通用 desktop；
- WeChat 在 16-bit/rgb565 虚拟 display 上出现色偏，已验证的配置是 24-bit/rgb888 + software rendering；
- P04 证明通用 Mousepad/Tight 路径保留 16-bit 更轻：比 24-bit 少约 4.52 MiB，并且每次滚动操作的 VNC CPU 低 41.7%；这不覆盖 WeChat 的 24-bit 正确性要求；
- P05 已把 `/rfb-compat` 的有序队列从 256 缩小到 8：慢客户端实验的 Go heap 增量从 16.18 MiB 降到 0.68 MiB，且完整输入、resize 和 reconnect 回归通过；
- P06 已把 SDK diagnostics 改成按需启用：kiosk 隐藏面板时没有 `/healthz` polling、diagnostics event 或隐藏 DOM 更新；instance lifecycle polling 与 caret watchdog 保持独立；
- P07 已把正常浏览器路径改为稳定 SDK loader + 两个 content-hashed immutable bundle：静态请求从 45 降到 3，本地冷传输从 551,233 B 降到 181,399 B，并通过 Unicode、application readback 与 reconnect 回归；
- P08 已让 systemd 直接监督 `Xtigervnc` MainPID，并把 class server driver 放入绑定 unit：lean server layer 从 42,831,872 B 降到 32,141,312 B；正常输入、resize、reconnect、wrapper fallback 和 VNC failure cleanup 均通过；
- P09a 已把 managed registry 改为仅在状态转换时持久化：四个健康周期的 `fsync`/rename 从各 4 次降到 0，同时通过 desired-state 转换、manager 重启接管、gateway 故障恢复和 Unicode reconnect；五秒 `xdpyinfo`/HTTP safety check 留给 P09b；
- P09b 已接受 host-wide cgroup-v2/inotify observer：30 秒健康窗口的 `xdpyinfo`/HTTP 从 6/6 降到 0/0，gateway/VNC failure 在 1.596 秒/642 ms 恢复，并保留 4-6 分钟 full-health safety pass；自动与交互回归均通过；
- P10 已把同一个 host-wide observer 扩展到 session unit：每个运行 session 的 30 秒 PID-file/`kill(0)` 从 60/60 降到 0/0，只增加一个 watch descriptor，不增加 per-session timer/goroutine；临时实例、managed restart adoption、poll fallback、生产 XFCE driver 与完整浏览器回归均通过；
- P11 已把 caret snapshot fan-out 改成每个 `/input` peer 一个独立 writer 和容量 1 latest-value queue：固定 10 ms 慢客户端不再让 publisher/快客户端等待约 324 ms，可靠 text ACK 与 RFB stream 不使用丢弃策略；
- P12 已把 SDK 普通文本的固定 40 ms debounce 改为可配置的默认 16 ms，并让完成的 `compositionend` 立即提交：单字符计时中位数从 40.490 ms 降到 16.278 ms，10 ms 间隔的五事件仍合并为一次提交；8/0 ms 会产生五次提交，因此没有作为默认值；
- P13 已把 gateway 成功 text 日志默认改为 `errors`：600 请求从 2,400 行/135,947 B 降到 0，write syscall 减少 29.6%，默认不再泄露输入明文；请求数、错误数、字节数和累计处理时间由无内容的 atomic health counters 提供；
- P13 只覆盖 Go gateway journal；Python private IBus engine 仍会为每次成功提交向 `engine.log` 追加一条不含正文的字节/字符统计（一次 open/append/close），该路径在 A/B 中保持不变，后续必须作为独立实验再决定是否移除；
- P14 先在独立的 `1992/:31` 栈证明 input stack 可以由 session 持有，随后部署到全部 production class；live Display 2 vacant server unit 从 16,887,808 B/18 tasks 降至 212,992 B/1 task，XFCE、Mousepad、Edge 的中英文、clipboard、resize/reconnect 和 cleanup 均通过；
- P15 已验证 SDK 0.15 的 remote-resize scheduler：零值保留 noVNC 行为，正值在等待期间本地缩放旧 framebuffer，支持 trailing debounce、有限 `resizeMaxWait` 和显式 `flushResize()`；真实 Chrome/TigerVNC 连续 resize、reconnect、Unicode 和 cleanup 均通过；
- Full XFCE 现在通过 generation-safe driver status 区分正常 Logout 与 crash：零退出码先原子报告 `exited`，manager 映射为 `sessionState: stopped`；非零退出仍为 `failed`。旧 persistent runtime 会在下一次 session start 自动获得最新 status schema；
- 停止 per-instance systemd cgroup 可以可靠清理该实例的 VNC、窗口管理器、IBus 和应用进程。
- 2026-08-27 已把 `test-host:1991` 切换为 enabled user-systemd manager，
  固定 display `:2` 由 managed registration `test-host-xfce` 持久托管；
  manager 重启保持 runtime ID、registry inode 与 unit PID，不再生成匿名重复实例。

当前 Go PoC 已实现本地多实例路由、managed registry 和本文第一阶段的
lifecycle manager，但仍未实现外部 API 鉴权、跨 host 调度或 WAOS adapter。

## 架构

```text
Phase 1: local browser client
  │ HTTP + WebSocket on one local manager endpoint
  ▼
Local RemoteXApp Manager
  ├─ static class catalog、instance state、local scheduler
  ├─ 建立/销毁 systemd per-instance cgroup
  ├─ browser client UI and same-origin path routing
  ▼
Per-instance runtime
  ├─ TigerVNC / Xtigervnc (loopback RFB)
  ├─ session supervisor
  │   ├─ private D-Bus
  │   ├─ optional private IBus + remote-unicode socket
  │   ├─ XFCE or Matchbox
  │   └─ managed application(s)
  └─ Go RFB + IME gateway (loopback; one X display / one instance)
```

### 控制面与运行面

| 层 | 职责 | 不应承担的职责 |
|---|---|---|
| Local RemoteXApp Manager | API、class 校验、display/资源分配、状态机、idle policy、启动/停止 cgroup、日志与本地 client 路由 | 直接把浏览器请求转为任意 shell 命令 |
| Per-instance runtime | 一个 X11 display、VNC、session、app 和其输入路径 | 为其他实例提供 X11/IBus 状态 |
| Phase 2 WAOS adapter | TLS、认证入口、WebSocket reverse proxy、把 identity/ticket 交给 manager | 改变 session class 或暴露 VNC TCP、D-Bus、IBus socket |

## 输入与传输模型

```text
browser noVNC ── WebSocket/RFB ──> Go gateway ── TCP/RFB ──> TigerVNC/X11

browser committed text ── /input WebSocket ──> Go gateway
  ── active X11 WM_CLASS check ──> private 0600 Unix socket
  ──> custom IBus engine ──> focused target app

focused app caret ── IBus set_cursor_location ──> private engine
  ── persistent Unix subscription ──> Go gateway cursor cache
  ── per-peer latest-value /input push ──> browser maps display pixels to canvas CSS
  ──> transparent local IME textarea follows the remote caret
```

- noVNC/RFB 已经承担普通控制；`/input` 不是第二套完整鼠标键盘协议，而是浏览器 IME committed-text 的专用通道。
- 拼音或其他 composing keystroke 不可转发到 RFB。
- IBus engine 必须和应用位于同一个 session D-Bus/X11 环境；它不是可共享的 host-level service。
- `client.sendText()` 是 Unicode/IBus 文本提交，不是键盘模拟，即使 ASCII 也不走 RFB。密码框、认证对话框及其他要求直接键盘输入的控件不属于其支持范围；应使用物理键盘或 RFB `sendKey()`（正确映射按键并配对发送按下/释放）。该限制是预期行为，不应作为普通输入框 IME 缺陷的证据。成功 ACK 仅表示 engine 提交，不保证应用插入；不得据此自动重发或切换输入通道，以免重复输入或向过期焦点泄露文本。详见 [SDK 输入契约](browser-sdk.md#sendtext-is-not-keyboard-simulation)。
- 每个 IBus commit 同时需要 IBus focus 和 active X11 `WM_CLASS` policy 检查。单应用 class 使用精确 allow-list；明确可信的 full-desktop class 可以显式使用 `*`。
- current POC 的 Go gateway 只绑定一个 display、一个 RFB address 和一个 IBus socket。因此第一版采用**每实例一个 gateway process**，而非把所有实例塞进一个 Go process。
- `/rfb-compat` 必须保持 RFB byte stream 的顺序和完整性。已验证的 queue capacity 是 8；队列满时使用 TCP backpressure，不能把任意 RFB chunk 当成独立视频 frame 丢弃。
- `cursor-position` 是可替换的状态快照。每个 `/input` peer 的容量 1 queue 可以用新位置覆盖尚未发送的旧位置；独立 writer 确保慢 peer 不阻塞 IBus subscription reader。text ACK、请求响应和任何 RFB byte 都不是可替换快照，仍需可靠发送。同一 peer 的所有 WebSocket write 必须共用一个 mutex。
- 普通浏览器 text `input` 由 SDK 在 16 ms 窗口内合并；已完成的 IME composition 是完整事务，应按序立即 flush。pending text/timer 只属于当前 WebSocket generation，disconnect/reconnect 时必须清除，不能跨通道补发。需要旧行为时显式设置 `textBatchDelay:40`，不要在上层 UI 再增加第二层 debounce。
- primary mouse/touch/pen 在 fresh remote caret 到达前是 native IME anchor；right/middle/non-primary 不可替换它。安全路径必须 force layout 并 renew textarea focus，late fresh caret 仍然权威，但 composition 或 queued/in-flight text 期间不得 blur/refocus。
- text logging 是 host operator policy，不是 class parameter 或 client API。默认 `errors` 只记录失败；`metadata` 可以短时记录无内容的成功阶段；`content` 会暴露输入文本，只能在授权测试窗口使用。manager 必须统一验证并向 per-instance gateway 传递该策略，普通客户端不能开启 `content`。

## SessionClass

`SessionClass` 是管理员管理、版本化、不可由普通客户端任意修改的模板。它描述一个实例如何运行；客户端只能提交经 schema 验证的参数。

配置与 driver 的边界如下：配置保存 manager 必须理解的声明式策略（实例数量、profile 隔离、display 分配、画面、activation、vacancy、readiness 与输入白名单）；driver script 保存如何建立具体环境的过程（D-Bus 服务、WM、应用、窗口调整和退出清理）。manager 不应包含 `xfce`、`matchbox` 或某个应用名称，配置也不应演变成可由客户端提交的任意 shell command。

```text
SessionClass
  ├─ display profile
  ├─ session driver
  ├─ managed app launcher（可选）
  ├─ input profile
  ├─ lifecycle defaults
  ├─ persistence profile
  ├─ resource limits
  ├─ readiness/health hooks
  └─ access/control policy
```

### Session driver

为避免 API 演变成任意远程 shell execution，class 不应直接允许调用方传入 `startScript=/path/...` 或任意 command。应只允许引用经过审查、由服务提供的 driver：

```text
xfce-desktop
matchbox-single-app
matchbox-kiosk
custom-approved-driver
```

driver 负责在**同一 X11 session**中建立 D-Bus、IBus、窗口管理器、应用子进程和退出清理。它应由 session supervisor 执行，而不是让多个独立 shell script 相互猜测 PID。

新的 App 应从 [`../examples/app-package/`](../examples/app-package/) 复制，并遵循
[`../drivers/README.md`](../drivers/README.md) 的 ABI 顺序：先安装 cleanup trap，
再报告 loading、启动 input/WM/app、发布 readiness、报告 ready，最后在应用退出时
报告 exited/error。manifest 保留声明式策略，包内脚本保留命令与应用级 readiness。

### 推荐初始 driver

| Driver | 启动内容 | 适用场景 |
|---|---|---|
| `xfce-desktop` | private D-Bus/IBus → `startxfce4` | 通用远程桌面、多应用操作 |
| `matchbox-single-app` | private D-Bus/IBus → Matchbox → 一个 app | WeChat、浏览器、普通单窗口 app |
| `matchbox-kiosk` | private D-Bus/IBus → Matchbox → app + class-specific UI/resize hook | Impress 演示、受限浏览器、垂直产品 UI |

即使完整 XFCE class 要支持已验证的浏览器中文输入，也不应直接无改动使用 `/etc/X11/Xsession`。`xfce-desktop` driver 必须先建立该实例私有的 IBus 环境，再启动 XFCE，使它及其后续应用继承 IM 环境。

## Instance

`RemoteXAppInstance` 是一个具体运行对象。

```text
instanceId
classId + classVersion
owner / tenant / access policy
validated launch parameters
profile reference and runtime paths
allocated display number and internal endpoints
state / timestamps / client count / failure reason
controller lease, if applicable
```

显示号和端口只是内部资源，不能作为对外实例身份。对外始终使用稳定的 `instanceId`。display 可在重建后变化；VNC TCP 端口也不应暴露给客户端。

### 参数

外部 API 不得接收任意 host filesystem path。示例中 WeChat 的 `homeFolder` 应改为由 manager 解析的 `profileRef` 或 managed volume ID：

```text
profileRef=wechat-account-42
```

manager 只在允许的实例数据根目录中解析该引用，并将其作为该 instance 的 HOME/XDG 路径。

## Display profile

class 可以定义 display 参数：

```yaml
display:
  initialSize: 1280x720
  depth: 16
  pixelFormat: rgb565
  frameRate: 5
  resizeMode: fixed       # fixed | remote | app-managed
  maxSize: 1920x1080
```

这应被视为 class 默认值而不是全局硬规则：

- 1280x720、16-bit、5 fps 是低动态普通 desktop 的合理候选起点，但需要按 app 测量；
- WeChat class 必须覆盖为 24-bit/rgb888，初始使用 10 fps；16-bit 色偏已被实测否定；
- `resizeMode=remote` 需要 TigerVNC `AcceptSetDesktopSize=1` 和 noVNC `resize=remote`；
- 浏览器集成可用 SDK `resizeDebounce`/`resizeMaxWait` 调度 remote resize，并在 resize gesture 结束时调用 `flushResize()`；初始连接和 reconnect 不等待 debounce，fixed policy 不发送远端 resize；
- Matchbox 单应用 class 还需要 app-specific resize handler；仅改变 X root 不会自动放大应用窗口；
- client 可请求的尺寸必须有 class 的最小/最大限制，避免用无界 framebuffer 消耗资源。

## Lifecycle

三类 instance 是 policy，而不是不同的底层技术：

| 类型 | `activation` | `idleTimeout` | `restartPolicy` |
|---|---|---|---|
| A：自动长期运行 | `boot` | `never` | `on-failure` |
| B：手动长期运行 | `manual` | `never` | `on-failure` |
| C：临时实例 | `manual` 或 `first-attach` | 有限时长 | 通常 `never` 或有限重试 |

建议 lifecycle state machine：

```text
requested → provisioning → starting → ready → idle → stopping → stopped
                              │                 │
                              └──── failed ──────┘
```

`starting` 与 `ready` 必须区分。API 创建请求返回 instance id 和状态；浏览器仅在 readiness 通过后连接 RFB。readiness 至少检查：

1. Xtigervnc 已建立 display 和 loopback RFB listener；
2. session supervisor 已启动；
3. class 要求 IBus 时，private Unix socket 已就绪；
4. 目标 app 的 class-specific readiness hook 已通过；
5. gateway 已能打开对应 X display。

TigerVNC 重启会使 gateway 的 native X11 connection 失效。因此 VNC server 故障必须被视作 instance runtime 重建，不能只重启 VNC 而保留旧 gateway。

### on-demand 的限制

stock `tigervncserver` wrapper 会立刻执行 `-xstartup`，所以它本身不能自然表达
“空 display server 先启动、完整 XFCE 等首个 client”。P08 已在 repository source
中移除这个耦合：systemd 直接监督 `Xtigervnc`，class server driver 使用独立且
`BindsTo` VNC 的 unit，应用 session 仍可在首次 attach 时启动。显式
`-vnc-launcher=wrapper` 只保留作兼容回退；当前未重启的 live display 2 仍运行旧 binary。

临时单应用 class 可以使用同一分层，但选择另一种 vacancy action：例如
`mousepad` 使用动态 display、隔离 profile、Matchbox session driver，首个 RFB
attach 才启动 session；最后一个 RFB detach 五秒后执行
`stop-instance`，将 server 和 session 两层全部停止。为了避免创建后从未连接的
实例永久泄漏，同一计时器也从 instance ready 时开始，首次 attach 会取消它。

`xfce-desktop` PoC 已实现 persistent empty display：

```text
manager start → TigerVNC + gateway + one-task server anchor → server-ready
first RFB attach → private session D-Bus/IBus/engine + XFCE → session-running → connect
last RFB detach → vacant timeout → stop session cgroup → server-ready
```

配置解析器仍保留 `input.lifecycle: server` 作为外部旧 class 的兼容默认值，
但仓库内全部 production class 显式使用 `input.lifecycle: session`。它把 private
D-Bus、IBus 和 remote-unicode engine 全部延迟到 first attach，并在 vacant
cleanup 时一起退出。此时长驻层只有
TigerVNC、gateway 和极小 readiness anchor；gateway 在 socket 不存在时持续退避
重连。live XFCE cold attach 为 4.188 秒，detached 期间不保留 input/clipboard
service。

旧 live binary 由 TigerVNC `-xstartup` 运行 `server.sh` 并由 remote-unicode engine 保活；
新 direct 默认则由单独的 server unit 运行同一 driver。
XFCE 由独立 systemd session unit 启动。server 与 session 共用 X11 和显式
`IBUS_ADDRESS`，但使用不同 private D-Bus；否则 XFCE 通过 D-Bus 激活的服务会
落入 server cgroup，vacant cleanup 后残留。server clipboard keeper 禁用 session
manager registration，并屏蔽 XFCE 自己的 clipman autostart，避免 session logout
清空 clipboard。

以上是当前 display 2 的实现，而不是最终优化目标。P03 已证明 disposable
single-app class 可以完全不启动 Clipman：server layer 稳态从约 62 MiB 降到约
39.5 MiB，输入和应用内复制粘贴正常。Full XFCE 的后续 P03b 方案是在不要求
跨 session 保留剪贴板内容时，将 Clipman 明确放进 session private D-Bus/cgroup，
使其激活的 AT-SPI、Xfconf 和 Portal helper 随 vacant session 一起退出。这个
迁移已经通过隔离的 P03b integration experiment：三次 session generation 验证了
exactly-one-Clipman、private session D-Bus、clipboard、input、reconnect 和 cleanup。
当前 live display 2 尚未应用该改动，因此仍不能把它视为当前部署。实验定义见
[`performance-experiments.md`](performance-experiments.md#p03b-move-full-xfce-clipman-into-its-session-layer)。

### Cleanup

systemd per-instance cgroup 是清理权威：

```text
stop instance
  → 禁止新 attachment
  → 结束 managed app
  → 结束 WM、IBus、D-Bus
  → 停止 TigerVNC 与 gateway
  → 删除 private runtime socket 与临时目录
  → 保留 profile/HOME，除非 destroy 明确要求删除
```

session scripts 必须有明确 TERM/INT/EXIT cleanup，且不能只 `wait Matchbox`。否则 app 退出后可能留下空 Matchbox session。临时 instance 的 idle 由 manager 的 authenticated attachment/heartbeat 计算，不能只相信某个 WebSocket 的 close event。

P10 后，session supervisor 退出由 session unit 的 `cgroup.events` 推送给
manager，并用 instance ID + session generation 排除迟到事件。默认路径复用
P09b 的一个 inotify FD/goroutine；每个 running session 只增加一个 watch
descriptor。`-session-observer=poll` 保留原 500 ms readiness PID fallback。
这个信号只证明 cgroup 已空，不能判断仍有进程但应用已经 hang 的情况。

## Access and sharing

`sharing` 与 `control` 必须独立配置：

```text
sharing: shared | exclusive
control: view-only | collaborative | controller-lease
```

“shared desktop”若不限制控制权，多个用户会同时抢鼠标、键盘和 X11 focus。默认建议：多人可观看、单一 `controller-lease` 可输入。WeChat 等帐号型应用默认应为 `exclusive`，或具备明确 agent/human handover。

### 第一阶段本地 client 与路由

第一阶段运行一个本地 `remotexappd`，默认使用单一 HTTP/WebSocket listener（例如 `0.0.0.0:1984`，仅限受控 LAN 测试）。它同时提供：

```text
GET  /                         local RemoteXApp Client
GET  /api/classes              可用 class
POST /api/instances            创建或取得 instance
GET  /api/instances/{id}       状态与 diagnostics
POST /api/instances/{id}/attach 请求连接
POST /api/instances/{id}/stop  停止 runtime
DELETE /api/instances/{id}     销毁 runtime；按策略决定是否删除 profile
```

manager 对每个 registered instance 反向代理同源 WebSocket 路径到其 loopback gateway：

```text
/remotexapps/{instanceId}/kiosk.html
/remotexapps/{instanceId}/rfb
/remotexapps/{instanceId}/input
```

现有 `kiosk.html` 假定 `/rfb` 与 `/input` 位于根路径。第一阶段 client/gateway 必须改为从 manager 注入的 instance route base 构造这两个 URL，或由 manager 为该 instance 提供等价的 scoped page；不能让多个实例共用未区分 instance 的根路径。

第一阶段不做认证或 ticket，只能用于受控内部网络。manager 仍必须仅代理已注册且 `ready` 的 instance，且不得把内部 VNC TCP、D-Bus、IBus socket、UNO 或其他 app socket 放进 API response。POC 当前的 same-origin 检查不构成生产鉴权。

第二阶段加入 WAOS 后，attach 会获得短期、仅限特定 instance 和权限范围的 ticket；WAOS 负责认证与外部 TLS/WebSocket reverse proxy，内部 instance URL 模型保持不变。

## Example classes

### Shared XFCE desktop

```yaml
id: xfce-desktop
version: 1
sessionDriver: xfce-desktop
managedApp: null
display:
  initialSize: 1280x720
  depth: 16
  frameRate: 5
  resizeMode: fixed
input:
  unicode: private-ibus
  lifecycle: session
  allowedWmClasses: ["*"]       # trusted full-desktop class only
lifecycle:
  serverActivation: auto
  sessionActivation: on-attach
  vacantTimeout: 10s
  restartPolicy: on-failure
access:
  sharing: shared
  control: controller-lease
persistence:
  kind: persistent-shared-home
```

当前语义：manager 启动时自动建立 TigerVNC server layer；首个 RFB WebSocket
启动 XFCE session layer；最后一个 RFB client 离开 10 秒后只停止 session layer，
返回 `server-ready`。display 和 gateway 继续运行，D-Bus/IBus/clipboard owner
随 session 退出，HOME 保留。

`xfce-desktop` 明确采用 `*`，使任意具有非空 `WM_CLASS` 的当前焦点应用可接收
Unicode commit；IBus engine 仍要求 enabled 且存在 focused input context。这是完整、
可信桌面实例的可用性取舍。Matchbox 单应用 class 不得继承该通配策略，必须配置明确
的 `allowedWmClasses`。

### WeChat single-app

```yaml
id: wechat
version: 1
sessionDriver: matchbox-single-app
managedApp: wechat
display:
  initialSize: 1280x720
  depth: 24
  pixelFormat: rgb888
  frameRate: 10
  resizeMode: app-managed
input:
  unicode: private-ibus
  lifecycle: session
  allowedWmClasses: [wechat]
lifecycle:
  activation: boot              # or manual
  idleTimeout: never
  restartPolicy: on-failure
access:
  sharing: exclusive
  control: controller-lease
persistence:
  kind: persistent-per-instance-home
parameters:
  profileRef: required
```

一个 WeChat profile 同时只应有一个运行实例。多个 account 使用多个 profileRef/HOME；不得共享 `.xwechat`。

## 第一阶段：本地服务与 client PoC

目标是证明服务模型，而不是认证模型。范围固定为一个 sandbox/host、一台浏览器和一个 local manager。

第一个历史 class milestone 是 `xfce-desktop`：固定 display `:2`，自动启动 server layer，并在 RFB attach 时按需启动具有独立 D-Bus 的 XFCE session layer；本地 manager 通过 instance-scoped path 提供 noVNC client。该未被使用的模板在 0.3 train 中退役，原实现保留于 Git 历史；当前完整桌面使用 `xfce-user-desktop`。

1. 实现 `remotexappd`：本地 class catalog、SQLite/JSON instance state、display allocation 和 systemd unit controller。
2. 把 POC 的 `systemd-run` 流程收敛为 per-instance managed cgroup；使用固定 service account。第一阶段的 HOME/profile 可在该 account 的受控数据根目录内。
3. 实现两个 driver：`xfce-desktop` 与 `matchbox-single-app`；先不支持任意 script、任意 command 或跨 host 调度。
4. 每实例启动一个现有 Go gateway，绑定 `127.0.0.1:allocated-port` 或 Unix socket。`remotexappd` 以 `/remotexapps/{id}/...` 反向代理 HTTP/WebSocket；不再为每个实例公开一个 `:1984`。
5. 实现 local browser client：列出 class、创建/停止 instance、显示 readiness，并用 noVNC 连接 manager 的 scoped RFB/input paths。
6. 实现最小 API：`create`、`get status`、`attach`、`stop`、`destroy`。`attach` 在 PoC 仅返回 scoped local viewer URL，不引入 ticket。
7. 实现 readiness、systemd cgroup cleanup、client-count idle timeout、日志与基本资源限制。
8. 先用两个类验收：
   - `xfce-desktop`：16-bit / 5 fps、fixed resize、server auto、session on-attach/vacant stop；
   - `wechat`：24-bit/rgb888、Matchbox、独立 profile、长期运行。
9. 使用回归矩阵验证：英文、已提交中文、IME 中英切换、焦点切换、浏览器 resize、断线重连、新窗口、app 重启和 instance stop。

### 第一阶段验收标准

```text
同一 local client 能创建一个 XFCE instance 与一个 WeChat instance。
两者有不同 instanceId、display、runtime path、gateway target 和 HOME/profile。
浏览器只连接 remotexappd 的一个端口，而不直接连接 VNC 或 per-instance gateway。
两类实例都能完成 RFB 控制、已提交 Unicode 文本、状态查询及停止清理。
停止一个实例不影响另一个实例或 manager。
```

## 第二阶段：WAOS integration

第一阶段稳定后，再加入 WAOS adapter：TLS、用户认证、instance-scoped ticket、权限策略和外部 WebSocket reverse proxy。WAOS 不改变 class、instance、session driver 或 per-instance runtime 的生命周期。

## 尚待确认的产品决策

1. shared instance 是否允许多人同时控制，还是使用 controller lease？
2. 临时 instance idle 后是否保留 HOME/profile，还是同时销毁？
3. agent 操作 WeChat 时，agent 与人是否共享同一控制权，还是需要明确 handover/lease？
4. 第二阶段是否需要跨 sandbox/host 调度？若需要，instance-to-host routing 和 profile storage 需在接入 WAOS 前扩展。
