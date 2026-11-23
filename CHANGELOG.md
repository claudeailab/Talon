## 1.0.129
- System updates: the Security and Other lists start closed; click a heading to open it

## 1.0.128
- Updates: the first tab is named Settings
- System updates: Other updates are highlighted in yellow, Security updates in red

## 1.0.127
- Updates is listed below Settings; the Talon card no longer shows a restart option
- System updates: clear Security and Other headings, both always shown
- Check now and other section actions are plain links, without a box appearing after a check

## 1.0.126
- New Updates page: General (status and settings for Talon and the system), Talon and System tabs that check when opened
- Notifications: Email, Notifications and Thresholds tabs; failed sign-in emails on by default
- More compact Create RAID levels and Dashboard Services card

## 1.0.125
- Settings: tidier tabs with one card of rows each, and a Save bar that only appears after a change
- SMTP moved to Notifications → Email; About removed (version under Update, hardware on the Dashboard)
- Update shows Talon and the operating system on one page

## 1.0.124
- Issues are shown once, in the bell; the status badge and the yellow cards on the Dashboard are gone
- Each issue shows since when it exists and a button that takes you to the fix

## 1.0.123
- Wiping a disk: one window with a confirmation, the steps as they run and a clear result; no terminal
- Disks: what a disk holds is in plain words and no longer cut off

## 1.0.122
- SD-card protection uses the same card as the other services; Statistics opens its numbers in a window

## 1.0.121
- SD-card protection shows what is written to the system disk and what it would save, or saved
- Services are listed as Enabled and Disabled

## 1.0.120
- SD-card protection is now a service on the Services page, off by default

## 1.0.119
- Website publishing retries when GitHub is slow to list the upload

## 1.0.118
- Antivirus is a service (off by default) with a single, compact page
- Tabs show a hand and a highlight on hover; OneDrive shows matching files as OK, not as a warning
- Activity shows 10 entries per page by default

## 1.0.117
- Settings → General: choose the date format and 12- or 24-hour time, used everywhere including emails

## 1.0.116
- Backup (formerly USB Backup) also uses internal SATA and NVMe disks and shows each disk's type
- Antivirus scans whole volumes; NFS and Bonjour are off after a fresh install
- Menu: Backup above Browser, Antivirus below Services; README and website list the new features

## 1.0.115
- Removed leftover code: the old system log address and the old automatic updates switch

## 1.0.114
- Removed the old /files redirect

## 1.0.113
- The Browser page is at /browser; old /files links still work

## 1.0.112
- Activity: one list for Talon and the system logs; choose what to show from the list
- OS updates: progress while checking, automatic install of all updates, restart screen that reconnects
- Navigation: new Files section (Browser, OneDrive, USB Backup); simpler Antivirus page with install progress

## 1.0.111
- New USB Backup page: copy shared folders to a USB disk when plugged in or every day
- Earlier versions that only store what changed; restore from Files

## 1.0.110
- Files: folder permissions; give a folder inside a shared folder its own users and groups

## 1.0.109
- WebDAV: shared folders over HTTPS at /dav for apps and remote access (turn it on in Services)

## 1.0.108
- New Antivirus page: scan shared folders with ClamAV on demand or on a schedule
- Infected files move to a quarantine; you get an email

## 1.0.107
- Dashboard: tap CPU, Memory, Network or Disk activity for up to a year of history
- Storage history shows how fast each volume grows and when it will be full

## 1.0.106
- Settings → Update: new Operating system tab to install updates with a progress bar
- Automatic security updates with optional restart; dashboard shows waiting security updates

## 1.0.105
- Settings: fewer writes to the system disk, on by default for SD cards and USB flash drives

## 1.0.104
- Activity: new System logs tab with Samba, NFS, SSH, disk and kernel messages

## 1.0.103
- Documentation: Browse files is in the volume's ⋯ menu

## 1.0.102
- Volumes: more compact header; Browse files moved into the ⋯ menu

## 1.0.101
- Disks: temperature shown on phones too; amber when a disk is too hot

## 1.0.100
- Website: data loss and backup notice on the home page

## 1.0.99
- README: data loss and backup notice

## 1.0.98
- Notifications subtitle: "Choose when Talon warns you"

## 1.0.97
- Shorter page subtitles

## 1.0.96
- Dashboard: host name and greeting removed; the status chip is centred at the top

## 1.0.95
- Dashboard: Shared Folders removed from the Storage card

## 1.0.94
- Groups: clear message when a name is already used by the operating system (for example users)

## 1.0.93
- EntraID users get web interface access when added; turn it off with Edit
- Email addresses wrap after the @ on phones

## 1.0.92
- Website: menu no longer overlaps the logo on the Screenshots page
- README: License section removed

## 1.0.91
- Groups tab is back under Users & Groups, with descriptions and member search
- Shared folder permissions: separate Users and Groups tabs with search
- Tabs on phones no longer cut off text

## 1.0.90
- EntraID setup guide: reordered and simplified steps

## 1.0.89
- EntraID setup guide: account type named as in the Entra portal

## 1.0.88
- EntraID setup guide: clearer steps; shows which permissions are for OneDrive sync and which for EntraID users

## 1.0.87
- Faster builds: tests run in parallel and release notes sync in one request
- Demo starts faster

## 1.0.86
- EntraID app: only the Application ID, Directory (tenant) ID and secret are needed
- Talon detects which accounts the app allows: work, school and personal OneDrive and Sign in with Microsoft
- Existing setups move over automatically

# Changelog

## 1.0.85
- EntraID: choose Work or school or Personal account; enter your email domain and Talon finds the tenant ID
- Setup guide asks which account you use and shows only the matching steps
- Existing setups are moved to the matching account type automatically

## 1.0.84
- Users: the EntraID Users tab shows once the EntraID app is set up, with the steps still needed

## 1.0.83
- EntraID Users: add people from your directory and give them web access with Sign in with Microsoft
- The sign-in page shows the password form only while an enabled local administrator exists
- The update button opens Settings → Update and checks for an even newer version

## 1.0.82
- Sign in to Talon with a Microsoft account (Settings → EntraID → Microsoft Sign-In)
- Password sign-in can be turned off once a Microsoft account is linked
- Recovery: sudo talon enable-local-login

## 1.0.81
- New website: home page, screenshots and the full documentation online
- The online documentation is generated from the guide built into Talon

## 1.0.80
- New screenshots in the gallery: OneDrive wizard, recycle bin and activity log
- Updated features list

## 1.0.79
- Files on phones and tablets: tap a folder to open it; the checkboxes select

## 1.0.78
- Documentation Contents on phones: bold group titles with a line between groups

## 1.0.77
- Documentation on phones: a clear Contents button with all topics, grouped
- A bar at the bottom while reading: previous topic, Contents, next topic

## 1.0.76
- Scheduled: a paused task shows "Paused" as its status again

## 1.0.75
- Scheduled: the status shows the last result (Idle, Succeeded, Failed, Stopped); a paused schedule shows as "Schedule paused"

## 1.0.74
- GitHub About section is filled in by the release workflow once a token is added

## 1.0.73
- Activity: the Tasks card is gone; the log uses the full width
- Background tasks in the log have Details with every step, kept after a restart

## 1.0.72
- Activity log records everything that happens in Talon, kept up to 20,000 entries
- Activity log: filter by operation and level, and search
- Scheduled output shows the latest run; earlier runs are in the activity log

## 1.0.71
- Scheduled output: earlier runs are in a dropdown instead of a list above the output

## 1.0.70
- Scheduled output: earlier runs are in a dropdown instead of a list above the output

## 1.0.69
- Scheduled: progress bar with rsync's real progress (--info=progress2) or "PROGRESS 45" lines
- Scripts that report nothing show how long they have been running and how long the last run took

## 1.0.68
- Scheduled output works like the OneDrive log: a time on every line, paths wrap at "/"
- While a task runs: "Working", or how long the script has printed nothing

## 1.0.67
- Phones: dialogs open in the middle of the screen and can use almost all of it

## 1.0.66
- Disks: removed the "sold as" size

## 1.0.65
- Sizes are counted like Windows and OneDrive (1 TB = 1024 GB), so they match File Explorer
- Disks also show the size they were sold as (for example "3.6 TB · sold as 4 TB")

## 1.0.64
- Files deleted on the Files page go to the volume's recycle bin for 30 days
- Recycle bin on by default for new shared folders (not with Time Machine)
- Two-way sync keeps what it deletes or replaces on the NAS

## 1.0.63
- Scheduled: the script box shows 10 lines

## 1.0.62
- Settings → Update: choose how often to check for updates (hourly to weekly, or never)

## 1.0.61
- Dark theme: dropdown lists are readable (dark list, light text)
- Menu and card titles capitalised: Shared Folders, Users & Groups, Activity Log, General & Sharing, …

## 1.0.60
- New OneDrive task wizard: what, folders, when, checks, done; editing opens a summary
- Files: Previous versions and a Recycle bin to restore replaced or deleted files
- Old copies are kept for backups from OneDrive only; OneDrive keeps its own versions

## 1.0.59
- Phones: text is never cut off with "…"; it wraps onto the next line instead
- Disks on phones: health and usage under the name, full disk model shown
- OneDrive on phones: account email and details on separate lines

## 1.0.58
- OneDrive tasks verify every file after each run (quick or full), with time estimates for your files
- Missing or different files are copied again automatically; only what still fails is reported
- Weekly or monthly full checks, and Quick/Full check now in the task menu

## 1.0.57
- Users: removed the duplicate Change password item; Edit changes the password

## 1.0.56
- Much faster OneDrive comparison on large drives (whole-drive listing)
- Live activity line: working, throttled by OneDrive, or waiting
- Size left to copy in the OneDrive log window

## 1.0.55
- OneDrive compares both sides first, then shows the real progress: Comparing, then Copying %
- Progress bar in the OneDrive log window
- Disks now sits above RAID in the menu

## 1.0.54
- OneDrive runs stopped by a restart (exit 143) resume instead of failing
- Log window hides the last error while a run is going, and shows its date

## 1.0.53
- OneDrive tasks: retry when they fail, and resume after a restart
- Logs show the time of every line and follow the newest one
- Dialogs on phones no longer slip under Safari's toolbar

## 1.0.52
- Activity: tap an entry to read the whole message
- Failed OneDrive tasks report rclone's actual error

## 1.0.51
- Scheduled and OneDrive task lists readable on phones

## 1.0.50
- iPhone: no more zooming in on fields, which made pages pan sideways
- OneDrive task logs readable on phones: time, file and message per line

## 1.0.49
- Settings on phones: icon tiles instead of a dropdown

## 1.0.48
- Renamed: Thresholds tab and EntraID tab
- Clearer description of the RAID data scrub

## 1.0.47
- Website publishing no longer fails when GitHub lists the upload late

## 1.0.46
- "Email" written as one word everywhere
- Files: the location name is no longer repeated next to its menu

## 1.0.45
- New screenshots and a shorter description on GitHub and the website

## 1.0.44
- Files: browse USB and other disks (with Eject) and OneDrive, not only volumes

## 1.0.43
- Documentation reviewed and corrected, including how to sign in after installing
- Menu order: RAID, Volumes, Disks, Files, OneDrive; Activity, Settings, Services
- Notifications page has tabs: Email and Alert thresholds

## 1.0.42
- Alert thresholds: disk temperature per disk type, volume full, SSD wear, bad sectors
- Card buttons move below the title on narrow screens

## 1.0.41
- Fixed: signing in after turning HTTPS off

## 1.0.40
- Support renamed to Documentation
- Shorter sign-in page

## 1.0.39
- A new RAID 5 shows "Building" instead of "Rebuilding" on its last disk

## 1.0.38
- HTTPS can be turned off (plain HTTP on port 80), for use behind Cloudflare
- Calendar for the Entra ID secret expiry date; fewer hints
- Disks page updates by itself after wiping a disk

## 1.0.37
- Settings > Networking: switch between DHCP and a static IP
- Network changes undo themselves if Talon is not reached within 3 minutes

## 1.0.36
- Scheduled: run commands and scripts on a schedule, with output history
- Entra ID: client secret expiry date with email reminders
- Dates shown as dd-mm-yyyy and times on the 24-hour clock

## 1.0.35
- Disks from another system's RAID can be wiped or used for a new RAID or volume

## 1.0.34
- Support page: a searchable guide to every feature, with steps and screenshots

## 1.0.33
- Dashboard Storage card also shows RAID arrays, shared folders and OneDrive

## 1.0.32
- One workflow run per change; releases only after the tests pass

## 1.0.31
- README dashboard image opens the screenshot viewer

## 1.0.30
- Screenshot viewer closes back to the README, like a modal

## 1.0.29
- Project website with a screenshot gallery: claudeailab.github.io/Talon

## 1.0.28
- README: screenshot gallery of the main pages

## 1.0.27
- README describes what Talon is and does
- Talon is now MIT licensed

## 1.0.26
- New Files page: browse your volumes, upload, download, rename, move and delete
- "Browse files" button on every volume

## 1.0.25
- OneDrive tasks can copy a single file as well as a folder
- Folder picker: click to select, double-click a folder to open it

## 1.0.24
- NAS folder picker: New folder button
- SMTP test shows its result step by step in the card, like the Entra ID test

## 1.0.23
- SMTP Test checks the server without sending an email
- Activity log: 10 entries per page with Previous and Next
- Dashboard: CPU temperature moved to the CPU card; speeds stay on one line

## 1.0.22
- OneDrive service: back up to or from OneDrive, or two-way sync (beta), on a schedule
- Settings now use tabs, with new Entra ID and SMTP tabs
- New Notifications page for email alerts

## 1.0.21
- All messages, service cards and hints fit on a single line
- Shorter service names, e.g. "Bonjour (mDNS)" and "NetBIOS"

## 1.0.20
- Shorter page descriptions that fit on one line

## 1.0.19
- Save buttons are greyed out until something is changed

## 1.0.18
- Settings: one compact "General & file sharing" card; Server description removed
- Disks without health data (e.g. virtual disks) show their use instead of "Unknown" and no 0°C

## 1.0.17
- A new RAID is named after its level by default, e.g. raid5

## 1.0.16
- New volumes are named volume1, volume2, … by default

## 1.0.15
- Disks of virtual machines show a readable name, e.g. "VMware virtual disk"
- No more single words left alone on the last line of a message

## 1.0.14
- RAID and Volumes are now separate pages: create a RAID first, then a volume on it
- Volumes can also be created on a single disk
- Existing volumes are moved to the new layout automatically

## 1.0.13
- Menus no longer get cut off or add scrollbars inside tables
- Disks, Users and Settings pages fit on phone screens without sideways scrolling

## 1.0.12
- Release pages now list what changed in each version

## 1.0.11
- Page title and description share one line
- Page headers moved up, level with the logo

## 1.0.10
- Removed a stray scrollbar under tab bars

## 1.0.9
- GitHub workflows updated to Node 24
- Duplicate release runs no longer fail

## 1.0.8
- Notification bell moved next to the logo
- Profile menu with Log out, Restart and Shut down
- Removed the empty top bar and the Settings power card

## 1.0.7
- Installer shows a progress bar while installing packages
- Install log saved to /var/log/talon-install.log

## 1.0.6
- README banner spans the full width

## 1.0.5
- Installer and uninstaller ask for root access themselves (no sudo needed)
- Leftover tags and releases are removed automatically

## 1.0.4
- README layout polish

## 1.0.3
- README: new banner, Access and Support sections

## 1.0.2
- Web interface always runs on port 443
- The user who runs the installer becomes the administrator
- Simpler README
