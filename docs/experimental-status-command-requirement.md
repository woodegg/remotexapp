# Experimental Application-Environment Status Command

**Request ID:** RXA-REQ-20260829-001

**Stable requirements:** EXP-001 through EXP-007

**Status:** EXP-001 through EXP-006 remain proposed; EXP-007 was implemented in
0.1.0-rc.23 and its explicit insecure-public sandbox opt-in is corrected and
validated in 0.1.0-rc.24

**Target release train:** 0.1.0-rc.23 (EXP-007), 0.1.0-rc.24 (sandbox access
correction)

**Initial downstream:** Web Agentic OS (host application)

**Initial command-execution target:** test-host-a only; EXP-007 is the separate
named operation validated on local port 1991

## Request

RemoteXApp should provide an explicitly experimental status operation through
which an authorized same-origin client can submit a custom command. RemoteXApp
executes that command with the active application's resolved session environment
and returns its bounded result.

The first host application use case runs `/usr/bin/env -0` when the user asks an Agent to
work with the user-home `xfce-user-desktop`. The host application extracts the current graphical
environment—such as DISPLAY, Xauthority, user runtime, D-Bus and audio
settings—and includes only the useful values in an Agent task.

This deliberately favors discovery flexibility over a stable product schema.
It is an experimental remote-execution capability, not a claim that arbitrary
commands are ordinary read-only status queries.

## Motivation

RemoteXApp owns the actual environment used to launch each application session.
A downstream viewer can currently read public lifecycle and display fields, but
production redaction intentionally removes HOME, Xauthority and private runtime
paths, and the API has no generic audio-environment description.

Inferring those values in host application would duplicate RemoteXApp policy and become
incorrect as templates, run modes or host audio stacks evolve. A flexible
status command lets the integration observe real environments first, identify
which values and probes are useful, and later replace this experiment with
small named, structured probes.

## Existing Status Relationship

The current driver status contract is snapshot-first: a session driver reports
validated readiness through `remotexapp-status`, and normal status GETs never
execute code. This request preserves that behavior.

The experimental command is placed under the status namespace because it
observes a current application session, but it is a separate on-demand POST. It
does not overwrite `application-status.json`, increment the durable status
revision, or become reconnect state.

## Canonical Environment Process

Every template already declares one runtime-local `session.readinessPid`. For
this feature, the live process identified by that file is also the template's
canonical environment process. A driver must write a stable process, not an
expendable launcher PID. Shipped rc.23 drivers standardize this as the session
driver process, whose initial exec environment is exactly the manager-provided
template environment. Each driver keeps any application PID in a separate
private runtime file for readiness and shutdown. This also handles programs
such as Edge that overwrite their own initial environment memory for a process
title, making the application process's `/proc/<pid>/environ` unrepresentable.

The manager resolves this generically as
`<instance runtime>/<session.readinessPid>`. It must not switch on a template ID
or hard-code template-specific PID filenames. Before reading the process
environment, it verifies that the PID is alive, belongs to the exact session
unit cgroup, runs as the same non-root UID as RemoteXApp, and still belongs to
the requested session generation. It repeats the generation check before
returning a result. The manager service must share the host mount namespace:
systemd filesystem-namespace options make Linux deny the required same-UID
cross-unit procfs read. The shipped units therefore retain their non-root UID,
`NoNewPrivileges`, restricted address families and other non-mount hardening;
the system service also retains its empty capability set. They do not enable
mount-namespace hardening.

The environment source is the canonical process's NUL-delimited
`/proc/<pid>/environ`, and its working directory comes from `/proc/<pid>/cwd`.
This means the contract describes the process's initial exec environment; it
does not claim to observe later in-process environment mutations. No template
environment snapshot is persisted.

### EXP-007 environment response

The rc.23 implementation exposes only this named, read-only operation from the
accepted EXP-007 scope:

```http
POST /api/instances/{instanceId}/status/environment
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "sessionGeneration": 3
}
```

The SDK method is:

```js
const result = await manager.getApplicationEnvironment(instanceId, {
  sessionGeneration: instance.sessionGeneration,
});
```

Because the result can contain credentials and other secrets, this operation is
normally available only when the manager uses authenticated `trusted-header`
mode or listens on loopback. A non-loopback `auth-mode=none` manager returns
`403` unless the administrator explicitly enabled `allow-insecure-public`.
That existing opt-in is an intentional override for controlled sandbox
deployments: it makes the complete result available to every client admitted
by the surrounding firewall or gateway and does not itself authenticate a
caller. The endpoint and SDK never log or cache the response.

A successful response is exactly:

```json
{
  "instanceId": "primary-desktop",
  "sessionGeneration": 3,
  "applicationState": "ready",
  "environment": {
    "DISPLAY": ":1",
    "XAUTHORITY": "/home/appuser/.Xauthority",
    "HOME": "/home/appuser",
    "XDG_RUNTIME_DIR": "/run/user/<uid>",
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/<uid>/bus"
  },
  "workingDirectory": "/home/appuser"
}
```

`environment` contains every variable from the canonical process's initial
environment, not only the graphical examples above. A successful response is
never filtered or truncated. If the complete environment cannot be represented
losslessly within the administrator-owned response limit, the request fails as
a whole instead of returning a partial map. `workingDirectory` is the resolved
canonical process directory.

The response does not contain a process ID, command, stdout, stderr or exit
code. The operation does not execute `/usr/bin/env` or any caller-selected
program. A missing/stopped session, non-ready application, stale generation,
invalid PID ownership/cgroup, unreadable environment or oversized result uses a
structured non-2xx response. The manager and SDK never log, cache, diagnose or
persist the returned environment.

## Proposed HTTP and SDK Contract

```http
POST /api/instances/{instanceId}/status/command
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "sessionGeneration": 3,
  "argv": ["/usr/bin/env", "-0"],
  "timeoutMs": 2000
}
```

The SDK exposes the same operation without accepting a shell string:

```js
const result = await manager.runExperimentalStatusCommand(instanceId, {
  sessionGeneration: instance.sessionGeneration,
  argv: ['/usr/bin/env', '-0'],
  timeoutMs: 2000,
});
```

An accepted response is transient and generation-qualified:

```json
{
  "experimental": true,
  "instanceId": "xfce-user-desktop-<runtime-id>",
  "sessionGeneration": 3,
  "applicationState": "ready",
  "exitCode": 0,
  "stdout": "DISPLAY=:1\u0000XAUTHORITY=$HOME/.Xauthority\u0000",
  "stderr": "",
  "durationMs": 12,
  "truncated": false
}
```

The response must distinguish rejected input, unavailable/stopped session,
generation mismatch, timeout, output truncation, nonzero exit and internal
execution failure. A nonzero command exit is a successful HTTP execution result
with its exit code and bounded stderr; request or containment failures use a
structured non-2xx error.

## Execution Semantics

The command runs with the exact current session's:

- non-root Unix UID and groups;
- HOME and working directory;
- DISPLAY and XAUTHORITY;
- XDG runtime directory and session D-Bus address;
- audio-related environment supplied to the application; and
- immutable instance and session generation.

It receives no stdin and no TTY. The initial protocol accepts a nonempty
absolute executable plus structured arguments and invokes it directly. It does
not implicitly use `/bin/sh -c`, expand variables, parse metacharacters or
accept a command encoded in a URL.

RemoteXApp must prove the requested generation is still current immediately
before launch and again before returning success. A stopped, starting, exited,
errored or superseded session is rejected. A query never starts or reconnects
an application session.

The subprocess must run in a manager-owned transient scope or equivalent
containment that permits the complete descendant process group to be terminated
on completion, timeout, disconnect or manager shutdown. A nominal status
command cannot leave background processes behind.

## Bounded Resource Contract

Initial limits are intentionally small and administrator-owned:

- timeout defaults to 2 seconds and cannot exceed 5 seconds;
- combined stdout and stderr is capped at 128 KiB;
- at most one command per instance may execute concurrently;
- duplicate concurrent requests are rejected rather than queued without bound;
- response and intermediate output are never cached or persisted; and
- no streaming, stdin, PTY, terminal resize or signal-control API is exposed.

Timeout terminates the entire command scope. Truncation is explicit and still
terminates or drains the process within the same deadline.

## Feature and Deployment Boundary

The endpoint and SDK method exist only when an administrator explicitly enables
an experimental flag such as:

```text
REMOTEXAPP_EXPERIMENTAL_STATUS_COMMAND=true
```

The default is disabled and the disabled route returns 404. Initial deployment
is limited to test-host-a. It must not be enabled on host application follower sandboxes or a
general RemoteXApp installation merely because the code exists.

The route retains the existing same-origin and RemoteXApp authentication
boundary. Enabling it materially expands that boundary: any caller able to use
the route can execute a process as the RemoteXApp account. Documentation and
health/version output must visibly report whether the experiment is enabled.

## Privacy and Audit Rules

`env` can contain credentials, proxy settings, access tokens or other secrets.
RemoteXApp therefore must not log argv, stdout or stderr. It may audit only:

- request and instance identifiers;
- session generation;
- start/end time and duration;
- exit category/code;
- byte counts and truncation; and
- authenticated identity when the existing auth mode supplies one.

The SDK must not copy command results into diagnostics, events, local storage or
durable instance state.

For the initial host application experiment, application code submits only the built-in
`['/usr/bin/env', '-0']` request. It parses NUL-separated entries, retains only
the variables needed to describe graphical access, and immediately discards
the complete result. It never records or forwards unrelated variables.

## Security Characterization

Structured argv prevents shell-string injection but does not make arbitrary
execution read-only. A caller could select a mutating executable. OS account and
container separation remain the actual security boundary; the words “status”
and “experimental” provide no isolation.

This risk is accepted only for the bounded test-host-a discovery phase. Promotion
requires a separate security review with retained abuse-case testing. No
production acceptance may silently reclassify the free-form operation as safe.

## Acceptance Criteria

1. The feature is disabled by default; route, SDK capability and health/version
   evidence agree in both enabled and disabled configurations.
2. Unit tests reject shell strings, relative/empty executables, malformed argv,
   stale generations, unavailable sessions, excess timeout/output and
   concurrent commands.
3. A real user-home `xfce-user-desktop` session runs `/usr/bin/env -0` and proves
   returned DISPLAY, XAUTHORITY, XDG runtime, D-Bus and available audio values
   match the exact application process environment.
4. The same live test proves the command runs as the expected non-root UID,
   uses no TTY/stdin, and leaves no process or cgroup after success, failure,
   timeout, client cancellation or manager shutdown.
5. Secret-bearing fixture variables prove output is returned only to the
   caller and absent from manager/gateway journals, status files, manifests,
   SDK diagnostics and browser persistence.
6. A generation rollover during execution cannot return a result as current or
   change the replacement session's durable status.
7. The host application test-host-a E2E proves only `/usr/bin/env -0` is submitted, only its
   explicit environment allowlist reaches the Agent task, and no full result is
   persisted or logged.
8. Documentation and operator UI label the feature experimental remote command
   execution and state its exact enabled scope.
9. One generic PID-resolution path covers every shipped template without a
   template-ID branch. Tests prove each declared readiness PID is the live
   canonical process, has the expected session cgroup and UID, and supplies the
   complete environment returned by the named operation.
10. The EXP-007 named endpoint and SDK method return the exact instance ID,
    session generation, application state, complete environment map and working
    directory shown by the contract. They return no PID or command result,
    never return a partial environment, and execute no caller-selected program.

## Exit and Productization Criteria

The experiment must collect which commands, variables and state are actually
useful, along with failures, duration, output size and security observations
that contain no command output. After review, choose one explicit outcome:

1. replace it with named, schema-validated probes such as
   `agent-environment` and remove free-form execution;
2. retain a separately packaged operator-only diagnostic facility with a new
   threat model; or
3. remove the experiment without compatibility guarantees.

The experimental endpoint and SDK method carry no long-term compatibility
promise. A later structured Agent Context does not have to preserve this request
or response shape.

## Non-Goals

- a general browser terminal or remote shell;
- shell pipelines, redirects, interpolation or interactive commands;
- starting, stopping or repairing the application session;
- persisting command history or environment snapshots;
- exposing internal RFB/gateway endpoints or manager credentials; and
- enabling the experiment on all RemoteXApp deployments.
