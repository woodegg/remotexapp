# Native automatic clipboard: consolidated UAT

This checklist covers Issue #50 / PR #54. Use the authenticated, project-owned
workbench supplied with the candidate. Historical manual D2 and audio acceptance
do not accept this increment. Test with temporary text and a disposable document.

## 准备 / Preparation

记录浏览器实际运行的操作系统、浏览器版本和输入法；如果隔着另一层远程桌面操作，
也记录本机系统。打开 **Mousepad**，确认 A/B 都连接成功，侧栏显示实际协议和统计。
本次使用新建的 Mousepad（测试包 1.0.3，Core 0.16.0-dev.5、SDK 0.31.0-dev.5）；
已有 App 保留原来的版本，不会因这次更新自动升级。
在侧栏展开 **剪贴板 · Clipboard**。每个 Viewer 的两个方向默认关闭，分别选择
**自动 Auto**，再点击 **授权自动剪贴板** 并处理浏览器权限提示。
请求模式和实际模式都应显示自动；权限不足时应显示原因或手动回退。

## 一次完成的端到端检查 / End-to-end checks

| 检查 | 操作与预期 |
| --- | --- |
| 本机 → 远程 | 在本机编辑器复制多行中文、英文和 emoji，点击 Viewer A，再按普通 Ctrl+V（macOS 用当前键盘配置对应的粘贴键）。内容应完整且只出现一次，无需每次点击传输按钮。也验证选中远程旧文本后粘贴替换。 |
| 远程 → 本机 | 在活动 Viewer 内输入新内容并复制，转到本机编辑器粘贴，确认读到刚复制的内容。仅选择文字不应当成复制。 |
| 离开与返回 | 离开 Viewer，在外面复制另一段文字，再返回粘贴。重复中英文输入法切换；不得粘贴旧值、漏字或多出快捷键字符。 |
| 独立方向 | 分别关闭一个方向，确认关闭的方向不自动同步；再验证手动传输和显式清空。空本机剪贴板不应自动清空远端。 |
| A/B 与独立标签页 | 给 A/B 分别授权，反复点击选择活动 Viewer；隐藏或关闭其中一个，另一个仍可使用。只有活动 Viewer 能执行自动操作；重新显示不能重放旧内容。A/B 共享同一个 App，因此远程文档本身相同。 |
| 权限与重连 | 拒绝一次权限、随后允许，再撤销权限，检查实际状态和手动回退。Reconnect 后须重新授权；未经重新同意不能自动同步。遇到冲突时明确选择手动传输方向，不应静默覆盖。 |
| UDP / WSS | 保持编辑以产生画面变化，观察 WebRTC UDP 的实际计数；关闭 Prefer WebRTC UDP 后继续双向复制粘贴，再重新启用并验证 UDP 画面恢复。静止时 FPS 为 0 可以正常，剪贴板始终使用可靠控制通道。 |
| 音频共存 | 开启 Speaker，运行远程声音测试并确认实际听见；开启 Mic，完成远程录音与回放。同时重复双向复制粘贴和 A/B 切换。关闭全部音频后，画面和剪贴板应继续工作。 |

首次权限提示、真实 OS 快捷键及实际听说效果需要人工确认；自动化授予权限和合成
音频不能代替这些结果。完成后在工作台记录每项通过、失败或未测试并导出结果。
发生失败时保留最短操作步骤、浏览器/系统信息和状态；不要附带私人剪贴板内容。

## Scope

This increment supports plain UTF-8 text up to 64 KiB. It does not advertise
file, directory, HTML, image or drag-and-drop clipboard support. Actual embedding
host/workspace integration, other browser engines and post-merge release
qualification remain separate gates. One browser/OS result does not accept the
entire platform matrix. Keep manual UAT rows unexecuted until actually tested.
