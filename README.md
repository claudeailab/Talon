<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
  <img src="docs/banner-light.svg" width="760" alt="Talon: Turn any Debian or Ubuntu computer into a NAS, with a modern web interface, software RAID, shared folders and users.">
</picture>

---

![Dashboard](docs/screenshots/dashboard.png)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/claudeailab/Talon/main/install.sh | bash
```

## Access

```text
https://<nas-ip>/
```

## Support

<div align="center">

| Supported OS | Architectures |
|---|---|
| Debian 12 (bookworm), 13 (trixie) | amd64, arm64 |
| Ubuntu Server 22.04, 24.04, 26.04 LTS | amd64, arm64 |
| Raspberry Pi OS 64-bit (bookworm, trixie) — Pi 3/4/5 | arm64 |

</div>

## Features

<div align="center">

| Disks | Layouts offered |
|---|---|
| 1 | Single disk |
| 2 | RAID 0, RAID 1 |
| 3 | RAID 0, RAID 1, RAID 5 |
| 4+ | RAID 0, RAID 1, RAID 5, RAID 6, RAID 10 |

</div>

- **RAID:** hot spares, expand, replace or remove disks, data scrub
- **Disks:** S.M.A.R.T. health, temperature, self-tests, secure wipe
- **Shared folders:** SMB and NFS with per-user and per-group permissions
- **Users & groups:** NAS accounts with Samba passwords kept in sync
- **Discovery:** appears in Windows Network and macOS Finder
- **Dashboard:** live system stats, storage health and alerts

---

![RAID wizard](docs/screenshots/raid-wizard.png)

## Updates

Updates are detected automatically and installed from the web interface.

## Uninstall

```bash
/opt/talon/uninstall.sh
```

Add `--purge` to also remove the settings. Your data is never touched.
