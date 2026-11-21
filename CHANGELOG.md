# Changelog

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
