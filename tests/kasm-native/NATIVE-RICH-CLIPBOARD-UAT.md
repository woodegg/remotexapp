# Native rich clipboard: consolidated end-to-end UAT

This checklist combines #54's native automatic clipboard policy with #56's rich
formats. Use the project-owned candidate workbench and disposable documents.
Historical text/audio acceptance is separate from acceptance of this extension.

## 准备 / Preparation

记录浏览器实际运行的操作系统、版本和输入法。使用新建的 **Mousepad** 测试文字，
使用 **Writer · HTML / PNG** 测试富文本和图片。候选为 Core 0.16.0-dev.6、
SDK 0.31.0-dev.6；旧 App 保留原来的组件和能力，不能用来判定新功能。
在侧栏 **Clipboard** 中启用两个方向的 **Auto**，授权浏览器剪贴板访问，并点击
要操作的 Viewer。确认实际能力显示 `text/plain, text/html, image/png` 和
`2097152 bytes`。首次权限提示必须由实际浏览器验证。

## 一次完成的检查 / End-to-end checks

| 检查 | 操作与预期 |
| --- | --- |
| 文字与输入法 | 本机和远程分别复制多行中文、英文、emoji，再到另一端粘贴。离开 Viewer 切换输入法、复制新内容，返回后用普通粘贴快捷键。不得漏字、重复、粘贴旧内容或误触发输入法快捷键。 |
| HTML 双向 | 用“复制测试 HTML”或本机编辑器复制粗体、颜色及列表，在 Writer 粘贴。反向在 Writer 修改样式、复制，再粘贴到本机富文本编辑器，确认格式保留。纯文本编辑器按其自身能力显示文字。 |
| PNG 双向 | 用“复制测试 PNG”或本机应用复制图片内容，在 Writer 粘贴；选中远端图片复制，再在本机图片或文档编辑器粘贴，检查尺寸和颜色。这里复制的是图片内容，不是文件。 |
| 合计大小 | 每次同步的所有表示合计最多 2 MiB（2,097,152 字节），不是每种格式各 2 MiB。超限应失败并保持目标原有内容，不得只留下部分文字。编码后的图片大小不等于解码后的内存占用。 |
| 排除项 | RTF、自定义格式、文件、目录和拖放不属于本次能力。不要把文件管理器中的“复制文件”当作图片剪贴板测试。 |
| 独立方向与清空 | 分别关闭一个方向，确认它不自动同步；测试手动传输和显式清空。空本机剪贴板应保持远端原值。 |
| A/B、标签页与不同 App | 每个 Viewer 独立授权，切换活动窗口，隐藏/关闭其中一个。只有活动 Viewer 自动同步；回来时不重放其他 App 的内容。同一 App 的 A/B 共享远程文档，这是预期行为。 |
| 权限、冲突与重连 | 测试拒绝、允许及撤销权限，观察实际模式和手动回退。同时改变两端内容时，应明确选择方向。Reconnect 后重新授权，旧内容不能自动恢复。 |
| WebRTC / WSS | 持续操作产生画面，确认 UDP 实际字节和帧计数增长；关闭 Prefer WebRTC UDP，继续双向粘贴，再恢复 UDP。剪贴板始终走可靠控制通道。 |
| 音频共存 | 开启 Speaker，确认实际听见远端播放；开启 Mic，完成远端录音/回放。同时进行富剪贴板操作与 A/B 切换。关闭所有音频后，画面和剪贴板继续工作。 |

在工作台逐项记录通过、失败或未测试并导出。不要附上私人剪贴板内容。
已记录一次 HTML 回读丢失粗体、随后重复未再现的观察。本轮请连续交替复制
纯文本、HTML 和图片，并分别在 UDP、WSS 及重连后检查格式；这项尚未判定修复。
自动化权限覆盖、合成输入/音频不能代替真实权限提示、物理输入法或实际听说测试。
实际宿主的嵌入、workspace 切换以及未测 OS/浏览器组合仍需各自验收。
