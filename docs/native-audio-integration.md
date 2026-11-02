# D3 音频接入计划 / Native audio integration

状态：**独立音频候选已实现，用户于 2026-11-01 确认当前 UAT 通过；等待 PR 审阅／合并。**
[Issue #45](https://github.com/woodegg/remotexapp/issues/45) 与 PR #49 跟踪实现和验收，
PR #48 提供工作台。实现候选为 `7926949`，Core `0.16.0-dev.4` / SDK `0.31.0-dev.4`。
见 [候选证据与用户验收](https://github.com/woodegg/remotexapp/blob/5c2a5f386e42f4529c206c2ed63e341b483d4830/tests/native-audio/qualification-7926949.md) 和 [实际音频合同](https://github.com/woodegg/remotexapp/blob/5c2a5f386e42f4529c206c2ed63e341b483d4830/docs/native-audio.md)。
本文保留接入时的研究输入、缺口和开发顺序；旧准备步骤不再表示当前待开发任务。
实际宿主集成、其他未验证范围及合并后的正式发布资格仍独立验收。
对应 [AUD-002](kasm-native-architecture.md#audio-model)、KNA-002/008/010。

## 1. 接入起点 / Preparation baseline

源码基线为 `ea0087fdb052b9c0791250f04846b3f0b5e1f6ee`，Core `0.16.0-dev.3` /
SDK `0.31.0-dev.3`；已发布版本仍是 Core 0.15.0 / SDK 0.30.0。
这里的 `audio:false` 描述接入起点；当前候选通过独立 `RemoteXAppAudio` API
提供音频，不将音频生命周期绑定到原生 Viewer。已发布版本不因此自动获得该能力。

| 原计划阶段 | 已完成的限定范围 | 后续边界 |
| --- | --- | --- |
| D1 | #31 已合并：Kasm/WSS、Manager 生命周期及基础 SDK | 默认 provider 未切换，正式发布资格单独验证 |
| D2 | #33 已合并：原生输入、显式文本剪贴板和统计；#35 提供 Alpine 静态 Core/UAT | 物理 OS/浏览器矩阵、程序化输入、丰富格式及实际 宿主应用 流程仍有未完成项 |
| D3 | #49 候选已完成域、Manager/SDK、独立音频及限定自动化；用户确认当前 UAT 通过 | #46 → #48 → #49 审阅／合并、合并后候选资格和实际宿主集成分别处理 |
| D4 | #37 已合并，受限 UDP/诊断/工作台 UAT 已接受 | 维持部署方配置端口池和 non-NAT 代理；更广网络与资源范围未自动验收 |
| D5 | 原有候选发布流程保留 | 合并后确切产物、迁移回退、长稳、配对 UAT 与发布分别验证 |

后来提出的多容器 UDP Host Agent（#42/#43/#44）已按用户要求放弃；它不属于 D3
前置依赖。现有 UDP 的部署合同不因音频接入改变。

## 2. PoC 可复用内容与缺口 / Reuse and gaps

研究输入是冻结的 `KNP-BASELINE-20261024`；可执行源码参考
`1e01a320f8dbb3423bfc68f49b571bb937dcb963`。音频历史候选为
`audio-mux-20261022-1`。核对其冻结源码和归档结果，未重新连接历史部署。
原始抓包、音频、凭据和环境配置留在私有证据中；下表仅记录可复核的技术结论。

| 研究内容 | 可以复用的经验/测试 | 产品缺口 |
| --- | --- | --- |
| Go mux / relay | 一条客户端音频 WSS、按会话分发、mic 独占与显式接管、有界缓冲 | PoC 固定注册 1–8 个后端，不能替代 Manager 的动态域注册、principal 与 generation 授权 |
| SharedWorker 协调 | 同会话多 Tab 状态、唯一播放者、一个采集源、断线/worker 恢复 | 纳入服务身份、登录 epoch、SDK 引用及权限撤销；真实 宿主应用 workspace 生命周期未验证 |
| 双会话声路 | 历史 17 项浏览器测试通过，已知音调远端读回和关闭一路后的独立性 | 使用两个 UID/Pulse 域；同一 UID 下多 App 路由仍需独立实验，不代表物理设备质量通过 |
| 播放及采集 | PoC 使用 MP2/MPEG-TS/JSMpeg 播放，48 kHz mono S16LE mic、20 ms 帧 | 编码/依赖/许可/发行、带宽/延迟/质量和设备兼容仍需选择与验证；不是最终协议承诺 |
| 生命周期 | 默认关闭、首个开关建立连接、最后关闭释放、权限取消与设备丢失测试 | 与 Manager stop/veto/recovery、runtime generation、借用账号服务和两个生命周期后端结合 |

2026-11-01 仅重跑了本地 `TestAudio(Mux|Relay)` Go race 测试和音频 worklet 检查，
均通过。worklet 检查包括 PCM 边界、20 ms/100 ms 分帧和无本地麦克风监听。
这些结果不包含真实浏览器、Pulse 设备、WAN、物理声卡或当前产品组合的重新验收。
PoC 的固定后端清单、Access 身份哈希和 reconnect capability 都不能直接充当产品 ACL。

## 3. 原定开发步骤及目的 / Original delivery sequence

以下为接入开始时的开发顺序，作为历史设计保留。D3.1–D3.4 的产品实现、限定自动化
和用户当前 UAT 决定见本文开头的候选记录；未验证边界以该记录为准。

### D3.1：同 UID 会话音频域

**目的：证明独立开关真正控制对应会话，关闭 A 不影响 B。** 在专用测试环境中用
同一个选定非 root UID 运行两个可独立路由的音频域，验证 speaker 和 mic 的已知
波形读回。模拟消息通过不能替代真实音频路由验证。

- 比较会话私有 Pulse 实例/路由，记录实际进程、socket、依赖、空闲资源和所有权。
- App 启动环境显式指向所属域；不覆盖全局 HOME/Pulse 配置，不停止借用的账号音频服务。
- 域身份绑定 runtime/generation；验证同时播放/录音、单域停止、域故障和重建、
  旧端点失效、服务清理及另一域继续工作。
- 同 UID 隔离是合作应用的功能路由，不是恶意租户安全隔离；后者仍需 UID/容器边界。

域何时准备必须与 App 启动契约一起选择。会话需要稳定的音频端点，不代表浏览器
已建立音频连接；R3 约束的是首次启用与最后关闭的连接/采集生命周期。
是否预建空闲域、何时启动 encoder/relay，应通过这一实验的成本与行为结果锁定。

### D3.2：Manager 与音频服务

**目的：把 PoC 固定会话改为产品管理的、可撤销的会话。** Manager 持有域注册表、
进程/socket 所有权和版本信息。浏览器只请求获准的 runtime，不提供 Pulse 路径、
目标 URL 或任意命令。音频授权单独绑定 principal、runtime/generation、域和连接
epoch；共享连接可订阅多个分别获准的域，不复用一次性显示 grant 充当全部音频权限。

对 stop/logout/升级和过期撤销对应订阅与 mic writer；其他 session 与显示继续工作。
网络续租和音频数据不能给 App keepalive 续命。复用服务故障、队列满、慢消费者、
Manager 重启和过期回调须有界处理，不误杀未知或借用进程。按实际接入确定版本化
消息、配额、到期时间和恢复策略，再进行故障与竞态测试。

### D3.3：SDK、跨 Tab 与用户操作

**目的：让应用宿主控制音频意图，而不是把音频绑在 Viewer DOM 上。** 在同一服务、
账号/登录 epoch、origin/profile/存储分区协调范围内复用一条独立 audio WSS。
默认两个开关关闭；至少一个 App 的 speaker/mic 启用才连接；全部关闭释放；静音
期间保持已启用的连接。这是已接受的 R3，不因本次准备重新改变。

实现 AUD-002 的其余目标时保留可观察状态：同 session 多 Tab 共用开关和唯一播放
订阅；一个 mic capture 仅发往显式选定目标，每个目标唯一 writer，冲突/接管可见。
焦点不改变目标。隐藏 workspace 保留明确持有的 audio interest；关闭最后引用才释放。
权限拒绝、设备失效、owner/worker 消失不能静默重新开启采集。
R4/R5 的产品细节与域实验共同定稿；不从 PoC UAT 推导全部选择已经验收。

无可用协调器或隔离能力时明确报告限制，不悄悄重复播放或把共享混音标成每 App 隔离。
只有对应服务/域/协议可用时才发布音频 capability；准备文档不改变当前 `audio:false`。

### D3.4：产品组合与人工 UAT

**目的：证明集成后的同一组产物可以工作，并明确交付边界。** 固定 Core/SDK/音频
组件版本，至少两 session、三个 Viewer（含同 session 两 Tab），验证真实播放与
远端 mic 读回、首开/全关/静音、单路关闭、多目标/抢占、权限拒绝、设备变化、
logout、workspace、worker/网络/Manager 故障和最终进程/FD/socket/track 清理。

本地模拟测试、浏览器合成音、物理耳机/话筒和实际 宿主应用 分别记录结果。长稳与
资源阈值在测量前锁定；已有显示 UDP 结果不替代音频资源或体验验收。
真实设备和 宿主应用 业务验收需要对应环境及人工参与；不能只凭连接成功标记通过。

## 4. 开发和交付边界 / Workflow

当前下一步是整理 #46 → #48 → #49 的依赖、完成审阅与 CI 后合并，再对确切合并
提交建立不可变候选。用户当前 UAT 通过不等于正式发布，也不要求重复每个开发检查点。
以下保留最初的分工；原首个实验已完成，不能把历史步骤误列为仍未开始的工作。

#45 保存实施进度和验收项。准备文档用独立 PR；运行行为用新的实现分支、工作目录
和关联 Draft PR，按检查点保留可运行验证路径。代码变更同步 requirements、
CHANGELOG 与追加式 design log，运行相关测试后执行 `make check` 及适用门禁。

第一实现提交应交付同 UID 域的可重复实验与结果，而不是先开放产品音频按钮。
实验只能操作项目拥有的专用环境；不能直接运行历史 PoC 部署脚本修改当前 UAT。
发布与部署仍遵守 [开发流程](development-workflow.md) 和
[生产交接](production-handover.md)，正式发布只使用验证过的确切产物。
