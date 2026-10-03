# Developer positioning and evidence

Research date: 2026-09-12. This is documentation research, not a comparative
benchmark or a claim of universal application compatibility.

## Core message

**Remote Linux desktops and apps, built for humans and AI agents.**

RemoteXApp brings a desktop or individual X11 application on a Linux VPS,
container or physical machine into a browser application. It combines local
IME input, rich clipboard exchange, runtime lifecycle APIs and package-defined
application control. Audio integration is WIP and is not available in the
current published product.

The developer value is the integrated contract: launch an App, connect a human
viewer, inspect runtime/control metadata, invoke supported actions, and manage
its lifecycle. An AI-agent sandbox fabric can use this interaction component
without treating RemoteXApp itself as the isolation or orchestration platform.

## What upstream projects already address

| Project | Official evidence | Implication for our positioning |
|---|---|---|
| noVNC | Its [project description](https://novnc.com/noVNC/) identifies a browser VNC client/library and lists Unicode clipboard copy/paste. | Do not claim noVNC lacks clipboard support. We use it for RFB viewing and add our application/runtime and interaction contracts. |
| Xpra | Its [clipboard guide](https://github.com/Xpra-org/xpra/blob/master/docs/Features/Clipboard.md) documents bidirectional exchange and browser/platform restrictions; its [audio guide](https://github.com/Xpra-org/xpra/blob/master/docs/Features/Audio.md) covers speaker and microphone forwarding. | Clipboard and audio are not novel categories invented by RemoteXApp. Our audio is still WIP. |
| Xpra input | Its [keyboard guide](https://github.com/Xpra-org/xpra/blob/master/docs/Features/Keyboard.md) discusses input methods and their configuration/compatibility issues. | Do not say input methods have never been addressed. Describe our specific local-composition-to-IBus path and its limits. |

These sources establish existing capabilities, not identical behavior across
every client or release. No head-to-head latency, resource-use, reliability or
IME-coverage measurements were performed for this documentation update.

## Defensible reasons to integrate

- Browser-first embedding: a served, release-matched SDK and multi-window
  Console, with reverse-proxy subpath support.
- Local interaction: separate keyboard and IME paths, plus automatic clipboard
  change detection and in-view rich-content prompts. Users see type, size and
  previews and approve the transfer without opening a separate clipboard panel
  or copying text through an intermediate box. Detection is opt-in and subject
  to browser permissions and focus; prompt sync does not mean unattended transfer.
- Human and agent access to the same runtime: visual interaction alongside
  generic connection descriptors and declared application actions.
- App extensibility: versioned templates/drivers deploy independently of a
  Manager rebuild, with immutable runtime pins and explicit upgrades.
- Plugin-style packaging, not hot-loaded code: the Manager reloads enabled
  App selectors on startup. Compatible Manager upgrades adopt existing runtimes
  after a service restart; API/viewer interruptions remain possible. Runtime
  component upgrades are a separate explicit restart operation.
- Tunnel-friendly transport: the HTTP/WebSocket gateway fits Cloudflare Tunnel
  routing without publishing VNC or host-local control ports. Cloudflare's
  [Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)
  documents WebSocket support, and its
  [WebSocket guidance](https://developers.cloudflare.com/network/websockets/)
  warns that infrastructure restarts can terminate connections. Heartbeats and
  reconnect support are resilience mechanisms, not uninterrupted-service promises.

These are a description of RemoteXApp's combination and developer contract,
not a claim that no competing project offers overlapping capabilities.
For clipboard messaging, emphasize the workflow rather than mere support:
**automatically detect, preview in place, confirm and paste**. Do not generalize
every noVNC-based integration as manual; embedding products can add their own
clipboard automation.
Implementation contracts are documented in the [SDK reference](browser-sdk.md),
[integration guide](integration-guide.md), [App Package design](app-package-major-release.md)
and [runtime upgrade API](runtime-upgrade-api.md).

## Claims to avoid

- “The first/only remote tool with IME, clipboard and audio.” Unsupported;
  audio is not yet shipped here and upstream tools already address these areas.
- “Works with every app, password field or browser.” `sendText()` depends on
  an input context; direct-keyboard controls need keys, and clipboard access
  depends on browser security and permissions.
- “Most remote-control software cannot deliver local IME.” No representative
  cross-product compatibility study establishes that claim here. Emphasize
  composing with the user's local IME and our dedicated IBus integration,
  rather than asserting an unmeasured market-wide limitation.
- “Secure sandbox for arbitrary untrusted code.” Profile/HOME separation is
  not tenant isolation. Supply Linux UID/container boundaries externally.
- “Runs in any container” or “controls any existing desktop.” Host prerequisites
  still apply, and RemoteXApp manages its own X11 runtimes.
- “Browser-accessible CDP/UNO endpoints.” Connection metadata is intended for
  trusted local automation; host-loopback addresses are not browser-local ones.

## Text identity

The README uses three playful ASCII scenes: an X-shaped teleport between local
and remote screens, an App delivery truck, and a human/agent pair. Keep them
monospaced, selectable and image-free. The delivery slogan refers to interactive
applications, not a different transport or a bundled agent. Audio remains
explicitly labeled WIP. The short tagline is **Remote apps. Local interaction.**
Use the longer headline when explaining the human/agent audience. Avoid adding
audio to an unqualified shipped-feature tagline until it is released.
