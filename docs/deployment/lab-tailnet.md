# Lab reverse proxy through an isolated Tailscale sidecar

This deployment connects an isolated Chronicler workspace to the lab's HTTPS
reverse proxy. The browser uses `https://chronicler.igvi.cs.nthu.edu.tw`; it does
not need a Tailscale client. Run the deployment commands from the repository
root in the Linux environment that owns the rootless Podman stack.

## Network path

```text
Normal browser
  -> lab reverse proxy: HTTPS, canonical hostname, access control
  -> sidecar Tailscale IPv4:80 over the lab tailnet
  -> userspace Tailscale Serve: TCP port 80 forward to web:5173
  -> isolated application, workers, database and evidence volumes
```

The TCP forward carries HTTP and preserves the public Host header. The
sidecar uses userspace networking and its own persistent identity. It does
not replace the personal Windows Tailscale installation, change its login, or
provide a host VPN interface. The final browser origin remains HTTPS even
though both proxy hops inside this path use HTTP.

The sidecar uses `TS_DEBUG_MTU=1200` for this lab proxy path. With the default
1280, small responses arrived but larger HTML/JavaScript responses stalled.
Reducing only the sidecar MTU restored complete public page and asset delivery.
The configured proxy upstream uses IPv4; IPv6 operation at this MTU has not
been verified. Recheck response sizes when changing the tunnel or proxy path.

## Prerequisites

- The existing Podman, Compose, NVIDIA CDI, model-cache and private `.env`
  prerequisites for the isolated application are available.
- A lab administrator authorizes the sidecar to join the lab tailnet and
  allows the reverse proxy to reach its Tailscale IPv4 on port 80.
- The administrator configures the canonical hostname, TLS certificate and
  browser access policy at the reverse proxy.
- The finals workspace uses distinct database, evidence and Tailscale-state
  volumes. A project filter alone does not isolate private research data.

## Bootstrap and routine operation

The `infra/tailnet.sh` wrapper combines the isolated application Compose file
with the tailnet overlay. It builds the web image for the canonical HTTPS
origin, rather than for a localhost URL. Use this wrapper consistently for
this workspace; the existing `infra/isolated.sh` is unchanged and has different
origin behavior.

The wrapper defaults are:

| Setting | Default |
| --- | --- |
| Workspace | `chronicler_finals` |
| Host loopback web port | `5178` |
| Web image | `localhost/chronicler-web:chronicler_finals` |
| Canonical browser origin | `https://chronicler.igvi.cs.nthu.edu.tw` |
| Tailscale node hostname | `chronicler-finals` |
| External Podman secret | `chronicler-finals-tailscale-auth` |

These defaults do not provision DNS, TLS, reverse-proxy authentication or
tailnet access permission. Coordinate those with the lab administrator.

On first enrollment, supply the lab-authorized bootstrap key as a Podman
secret prepared separately by the operator. Never place the key in a shell
command argument, tracked configuration, documentation, screenshot or log.
Create the external secret using the wrapper's silent prompt:

```sh
./infra/tailnet.sh init-secret
```

The wrapper sends the key to Podman through standard input. Inside the
container, `TS_AUTHKEY=file:/run/secrets/chronicler-finals-tailscale-auth`
references the mounted secret; its value is not a key. The pinned Tailscale
image uses `TS_AUTH_ONCE` and a persistent state volume. Preserve that volume
after successful enrollment so ordinary restarts reuse the same node identity.

Build the web image. Build the media image too if it is not already present;
the isolated base file otherwise expects that local image to exist.

```sh
./infra/tailnet.sh build web
./infra/tailnet.sh build media
./infra/tailnet.sh up -d
./infra/tailnet.sh ps
```

Inspect the sidecar without printing the enrollment secret:

```sh
./infra/tailnet.sh exec tailscale tailscale ip -4
./infra/tailnet.sh exec tailscale tailscale status --json
./infra/tailnet.sh exec tailscale tailscale serve status
```

The Serve configuration forwards TCP port 80 to `web:5173`. It does not use
Tailscale HTTPS certificates or an HTTP Host-routing rule.

A retained state volume normally avoids another enrollment; node revocation,
expiry or loss of that volume can require the administrator to authorize
enrollment again. The external Podman secret may still be required when
Compose recreates the container, even when authentication is reused. Keep the
Podman secret resource for recreation. After successful enrollment, the lab
administrator can revoke the bootstrap auth key without removing the enrolled
device; the persistent device identity is separate from that key.

For inspection-only access, stop the complete stack before changing modes.
This avoids Podman Compose's dependent-container replacement issue and stops
queued model workers. Then start only the database, guarded web application
and sidecar. These are operator commands, not a record of an executed test:

```sh
./infra/tailnet.sh down
CHRONICLER_READ_ONLY=1 ./infra/tailnet.sh up -d database web tailscale
```

Do not add `-v`: keep database, evidence and tailnet-state volumes. The HTTP
read-only guard alone does not stop queued worker writes or external import
commands. Keep those writers stopped, and prevent the Windows host launcher
from restarting the full stack, while inspecting a frozen snapshot.

Deliberately resume the complete writable stack with:

```sh
./infra/tailnet.sh down
CHRONICLER_READ_ONLY=0 ./infra/tailnet.sh up -d
```

To stop containers without removing them or their volumes:

```sh
./infra/tailnet.sh stop
```

## Reverse proxy handoff

Give the administrator `http://<sidecar-tailscale-ipv4>:80` as the upstream,
using the address returned by `tailscale ip -4`. Do not give them the host's
loopback application port or the personal Windows Tailscale address. Preserve
the public Host and Origin headers and forward the HTTPS scheme through the
reverse proxy, then verify actual form submissions.

Set the proxy's upload-size and timeout policy deliberately: the application
accepts source files up to 512 MiB, while the HTTP request also includes form
overhead. Check that the chosen proxy policy permits the intended demo upload.

## Shared sign-in

The application enforces its own sign-in when `CHRONICLER_ACCESS_USER` and
`CHRONICLER_ACCESS_PASSWORD` are set in the private `.env`. Every page,
`/api/*` route, raw asset, download, export and trace then requires a
sign-in; only read-only `/api/health` stays open for liveness probes. Browsers
get a full-screen sign-in page and a 14-day session cookie, with Sign out in
the page footer. Scripts may send HTTP Basic credentials instead.
Because the check runs inside the application, it also applies to tailnet
members who reach the sidecar directly instead of through the reverse proxy.

An optional second account, `CHRONICLER_ACCESS_VIEWER_USER` and
`CHRONICLER_ACCESS_VIEWER_PASSWORD`, can inspect everything but cannot upload,
push, review, ask or remove. Changing requests are also refused when they come
from another site. Changed credentials take effect after `down` and `up -d`
and sign everyone out; no image rebuild is needed. The sign-in form only
accepts submissions from the public origin, so sign in through the public
address rather than the loopback port.

This is one shared workspace with shared accounts. It does not create
per-person identities, per-user roles or a tenant boundary, and review history
does not record which person approved a change. A second login at the
reverse proxy is unnecessary and would make people sign in twice. Tailnet
access controls restricting the upstream to the proxy remain worthwhile as a
second layer.

## Model fallback

Interpretation, organization, comparison, translation, summaries and Ask use
the configured OpenAI-compatible model. If that gateway fails with a
connection error, a timeout or HTTP 408/429/5xx, the worker can resend the same
request to a second model configured with `OPENAI_FALLBACK_MODEL`,
`OPENAI_FALLBACK_BASE_URL` and `OPENAI_FALLBACK_API_KEY` in the private `.env`.
After a failure the primary is skipped for `LLM_FALLBACK_COOLDOWN_MS` (two
minutes by default) and then tried again. Request errors such as HTTP 400,
budget refusals and cancellations never switch models. Local MOSS speech
recognition does not depend on either model.

The usage ledger records which model received every attempt; the Operations
page lists today's requests per model, and an Ask answer states the models that
answered it when the fallback was involved. Other saved outputs still name the
configured primary model, so use the ledger for exact provenance. While the
fallback is active, transcript text and images go to that provider: disclose it
and use only material approved for it.

Check both models before a demonstration (prints status and timing only):

```sh
podman exec chronicler_finals_worker_1 bun apps/web/src/lib/server/llm/check.ts
```

Changing these settings needs `down` and `up -d`, not an image rebuild.

## Verify the deployed workflow

- Confirm the sidecar is enrolled and record its current Tailscale IPv4.
- Check that the lab reverse proxy reaches that IPv4 on port 80.
- Open the canonical HTTPS URL from a normal browser on another network.
- Verify unauthenticated requests cannot read pages, API responses, evidence
  assets, exports or traces.
- Exercise a form or short upload through the exact HTTPS origin. A working
  landing page alone does not establish correct origin handling.
- Inspect a saved citation, review event and answer in the intended isolated
  workspace. Check a real short media/model operation before declaring the
  complete pipeline ready.
- Restart the stack and confirm that the same tailnet identity, database and
  evidence remain available.

## Availability and recovery

### Windows host session

From PowerShell in the repository root, the optional helper installs the
`ChroniclerLabHost` scheduled task for the current user's logon and starts it:

```powershell
powershell -NoProfile -File .\infra\windows-tailnet-host.ps1 -Install
Get-ScheduledTask -TaskName ChroniclerLabHost
Get-ScheduledTaskInfo -TaskName ChroniclerLabHost
```

Installation may require Administrator permission. The task starts a hidden
PowerShell process and `infra/host-session.sh` in WSL. That script starts the
stack with `up -d` and keeps the WSL session alive. A temporary idle-sleep
guard applies while the host process runs; it does not change the power plan.
The Windows host must remain on and the user session available. Manual sleep,
shutdown, logout, loss of network or stopping WSL still interrupts access.

To stop hosting, stop the application containers from Linux using
`./infra/tailnet.sh stop`, and stop the Windows keepalive task:

```powershell
Stop-ScheduledTask -TaskName ChroniclerLabHost
```

Stopping the task alone is not a container shutdown command. The registered
task can start again at the next user logon.

On November 12, 2026, the host recovered after an administrator restarted
WSL. The Windows task was installed and observed running, and the isolated
sidecar enrolled successfully. The application image build, local HTTP pages,
origin checks, internal service connectivity and retained sidecar identity
passed the checks recorded in
[deployment verification](../development/lab-tailnet-verification.md).
The public DNS/TLS/proxy path and fresh-browser rendering subsequently passed
after the sidecar MTU adjustment. Public form-origin checks also passed.
Authentication, real uploads/inference and a Windows reboot still need their
own checks before calling the complete evaluator workflow ready.

### Persistent data and troubleshooting

Keep the database, evidence and Tailscale-state volumes during routine stops
and rebuilds. Do not remove volumes to repair a connectivity problem. Back up
the application workspace using the maintained operations procedure, and
protect tailnet state as an authentication credential.

A running sidecar does not keep Windows or WSL alive. Sleeping the host,
stopping WSL, losing connectivity or stopping Podman makes this upstream
unavailable. Rehearse host restart and startup recovery; do not describe a
temporary WSL session as a durable lab-server service. Keep the submitted
actual-operation video available independently of the live endpoint.

For failures, check the browser-facing proxy, its upstream tailnet permission,
sidecar enrollment and Serve configuration, then the internal web service and
application dependencies. Correct the failing layer without disabling origin
checks or exposing the unprotected application port.
