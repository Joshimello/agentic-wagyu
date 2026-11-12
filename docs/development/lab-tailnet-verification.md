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

The container IP and node metadata are kept in the private operator handoff,
not required as hardcoded values in deployment source.

## Still requiring external validation

- An authorized lab-tailnet peer must request the sidecar's port 80. A local
  self-dial test returned no HTTP response and is not counted as a forwarding
  pass or proof of remote ACL reachability.
- The public hostname did not resolve from this host during the check. The
  senior must configure DNS, TLS, proxy routing and authentication, and test
  from an ordinary browser outside the host's private network.
- Verify the proxy protects pages, APIs, raw assets, exports and traces, while
  allowing the intended uploads and media playback. Tailnet ACLs should also
  prevent bypassing that access gate through the upstream directly.
- Run an actual model/media operation and a representative upload through the
  final proxy. Deployment checks did not call models or measure inference
  accuracy, latency or cost.
- A Windows reboot, logout, manual sleep and full recovery were not exercised.
  The logon task and scoped idle-sleep guard do not make the machine available
  while powered off or disconnected.

Earlier WSL launch failures coincided with a Windows controller error on the
USB disk holding the Ubuntu virtual disk. Recovery of the current session
does not establish long-term storage reliability; retain a verified backup.

## Operator references

- [Deployment and proxy handoff](../deployment/lab-tailnet.md)
- [Backup, restore and normal operations](../operations.md)
