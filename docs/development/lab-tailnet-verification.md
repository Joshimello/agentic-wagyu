# Lab tailnet backend verification

Recorded November 12, 2026 on the Windows/WSL host. Deployment code is based
on local commit `f584784`; application behavior is unchanged from the earlier
application revision. These are deployment checks, not model-quality results.

## Completed checks

- Recovered Ubuntu after the operator restarted the Windows WSL service.
- `bash -n` accepts `infra/tailnet.sh` and `infra/host-session.sh`.
- Parsed the merged Compose configuration in memory without printing model
  credentials. Confirmed the public HTTPS build origin, loopback port 5178,
  isolated volumes, file-based enrollment secret, userspace mode and restart
  settings.
- Built `localhost/chronicler-web:chronicler_finals` successfully with the
  canonical origin `https://chronicler.igvi.cs.nthu.edu.tw`.
- Pulled the pinned official Tailscale image and started all six services.
  Database, media, web and sidecar health checks passed; both workers ran.
- Tested the enrollment helper with an invalid input: it hid the input,
  rejected it and did not create a secret. Enrolled with an authorized key
  supplied through the hidden prompt and standard input to Podman. No literal
  enrollment key was stored in project files or command arguments.
- Sidecar reached Running and Online. TCP port 80 forwards to `web:5173`;
  there is no TUN device, host networking, published sidecar port or Funnel.
- Sidecar access to `http://web:5173/api/health` returned HTTP 200.
- Host-loopback `/api/health`, `/`, `/changes` and `/ask` returned HTTP 200.
- A form-compatible request carrying the correct public Origin and Host
  reached input validation and returned the expected HTTP 400 for an empty
  payload. A different Origin returned HTTP 403. No research job was created.
- Restarted the sidecar; after startup settled, its Tailscale IPv4 and Serve
  configuration were unchanged. It became healthy again.
- Confirmed distinct finals database, evidence and Tailscale-state volumes;
  the personal main workspace has separate database/evidence mounts.
- Fresh finals database has zero uploads, memory commits and research runs.
  This deployment did not import private main-workspace evidence or seed a
  scenario.
- Installed `ChroniclerLabHost` as a limited current-user logon task. Observed
  Running state, unlimited execution duration, IgnoreNew instance policy,
  restart settings and a live `/bin/sleep infinity` WSL hosting process.
- After the senior configured the public proxy, reproduced a size-dependent
  delivery failure: health and 548-byte JavaScript completed, but a 1,400-byte
  asset and the 16,104-byte homepage timed out before response headers. Ranges
  of 256/512 bytes from that same asset passed; a 1,024-byte range stalled.
- Confirmed local rendering and static assets were healthy. A correctly
  constructed Linux self-dial through the node's Tailscale address also
  returned the complete homepage, so the backend was not missing frontend
  files. The exact peer-path bottleneck was not independently identified.
- Set only the userspace sidecar's `TS_DEBUG_MTU` to 1200 and recreated that
  sidecar, preserving its identity. The full public homepage and formerly
  stalled asset then returned HTTP 200 in approximately 0.4 seconds.
- A fresh headless Chrome session rendered the complete public Staging UI.
  All 18 JavaScript files, seven stylesheets and one font returned HTTP 200;
  no console exceptions, failed requests or HTTP errors were observed.
- Through the public HTTPS proxy, repeated the invalid form request: the
  correct origin returned application validation HTTP 400; an incorrect
  origin returned HTTP 403. No model request or research job was created.

The container IP and node metadata are kept in the private operator handoff,
not required as hardcoded values in deployment source.

## Still requiring external validation

- Verify the proxy protects pages, APIs, raw assets, exports and traces, while
  allowing the intended uploads and media playback. Tailnet ACLs should also
  prevent bypassing that access gate through the upstream directly.
  The fresh public browser session had no application credentials; public page
  rendering is not evidence that access protection has been configured.
- Run an actual model/media operation and a representative upload through the
  final proxy. Deployment checks did not call models or measure inference
  accuracy, latency or cost.
- IPv6 delivery with the reduced sidecar MTU was not tested; the senior's
  configured upstream is the IPv4 endpoint.
- A Windows reboot, logout, manual sleep and full recovery were not exercised.
  The logon task and scoped idle-sleep guard do not make the machine available
  while powered off or disconnected.

Earlier WSL launch failures coincided with a Windows controller error on the
USB disk holding the Ubuntu virtual disk. Recovery of the current session
does not establish long-term storage reliability; retain a verified backup.

## Operator references

- [Deployment and proxy handoff](../deployment/lab-tailnet.md)
- [Backup, restore and normal operations](../operations.md)
