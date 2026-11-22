<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
  <img src="docs/banner-light.svg" width="100%" alt="Talon: Turn any Debian or Ubuntu computer into a NAS, with a modern web interface, software RAID, shared folders and users.">
</picture>

---

**Talon is self-hosted NAS software for Debian, Ubuntu and Raspberry Pi OS.** It turns a PC, mini-PC or Raspberry Pi into a home NAS that you manage from your browser.

RAID, shared folders, users, OneDrive backup and alerts. One command installs it; updates install from the web interface.

[![Dashboard](docs/screenshots/dashboard.png)](https://claudeailab.github.io/Talon/screenshots.html#dashboard)

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

- **Dashboard:** live system stats, storage health and alerts
- **Disks:** S.M.A.R.T. health, temperatures, self-tests and wipe
- **RAID:** hot spares, expansion, disk replacement and data scrub
- **Volumes:** ext4 or XFS on a RAID array or a single disk
- **Files:** browse volumes, USB disks and OneDrive in the browser
- **Recycle bin:** restore deleted files and earlier versions for 30 days
- **OneDrive:** backup or two-way sync, verified after each run
- **Shared Folders:** SMB, NFS and Time Machine with per-user permissions
- **Users & Groups:** accounts for shared folders and the web interface
- **EntraID Users:** people from your organization sign in with Microsoft
- **Discovery:** appears in Windows Network and macOS Finder
- **Activity:** a searchable log of everything that happens
- **Networking:** DHCP or static IP, HTTPS on or off
- **Scheduled:** scripts on a schedule, with live output and progress
- **Notifications:** email alerts with adjustable thresholds
- **Mobile:** works on phones and tablets, light and dark mode
- **Documentation:** built-in searchable guide

## Screenshots

Click a screenshot to open the [gallery](https://claudeailab.github.io/Talon/screenshots.html). More on the [website](https://claudeailab.github.io/Talon/).

<table>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#volumes"><img src="docs/screenshots/volumes.png" alt="Volumes on RAID or single disks"></a><br><sub>Volumes on RAID or single disks</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#raid-wizard"><img src="docs/screenshots/raid-wizard.png" alt="RAID wizard"></a><br><sub>RAID wizard</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#files"><img src="docs/screenshots/files.png" alt="Files on volumes, USB disks and OneDrive"></a><br><sub>Files on volumes, USB disks and OneDrive</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#recycle-bin"><img src="docs/screenshots/recycle-bin.png" alt="Recycle bin"></a><br><sub>Recycle bin</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#onedrive"><img src="docs/screenshots/onedrive.png" alt="OneDrive backup and sync"></a><br><sub>OneDrive backup and sync</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#onedrive-wizard"><img src="docs/screenshots/onedrive-wizard.png" alt="OneDrive task wizard"></a><br><sub>OneDrive task wizard</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#share-permissions"><img src="docs/screenshots/share-permissions.png" alt="Shared folder permissions"></a><br><sub>Shared folder permissions</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#users"><img src="docs/screenshots/users.png" alt="Users &amp; Groups"></a><br><sub>Users &amp; Groups</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#activity"><img src="docs/screenshots/activity.png" alt="Activity log"></a><br><sub>Activity log</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#scheduled"><img src="docs/screenshots/scheduled.png" alt="Scheduled scripts"></a><br><sub>Scheduled scripts</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#notifications"><img src="docs/screenshots/notifications.png" alt="Thresholds"></a><br><sub>Thresholds</sub></td>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#documentation"><img src="docs/screenshots/documentation.png" alt="Built-in documentation"></a><br><sub>Built-in documentation</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><a href="https://claudeailab.github.io/Talon/screenshots.html#dashboard-dark"><img src="docs/screenshots/dashboard-dark.png" alt="Dark mode"></a><br><sub>Dark mode</sub></td>
    <td width="50%"></td>
  </tr>
</table>

## Updates

Updates are detected automatically and installed from the web interface.

## Uninstall

```bash
/opt/talon/uninstall.sh
```

Add `--purge` to also remove the settings. Your data is never touched.

## License

[MIT](LICENSE)
