# Talon for iPhone

Browse the files on your Talon NAS and back up your camera roll to it.

- **Files:** the shared folders you may open, their folders and files. Tap a file to
  preview it (photos, videos, PDFs, documents) and share it. Upload files and photos,
  create folders, swipe to delete.
- **Photos:** backs up the camera roll to a folder you choose, sorted into
  `<folder>/<year>/<year-month>/`, as the original files with their original dates.
  Each photo is uploaded once. Optionally videos too, and every time the app opens.

It talks to Talon over WebDAV (`https://<nas>/dav/`) with a Talon user name and
password, so each user sees exactly the shared folders they may open, read-only or
read & write. Turn **WebDAV** on under **Services** in Talon first.

Talon's own HTTPS certificate is trusted once: the app shows its SHA-256 fingerprint
when you connect for the first time.

## Install it on your iPhone

You need a Mac with Xcode 15 or later.

```bash
brew install xcodegen
cd ios && xcodegen && open Talon.xcodeproj
```

In Xcode: select the **Talon** target → **Signing & Capabilities** → choose your
**Team** (a free Apple ID works; it is valid for 7 days, a paid Apple Developer account
for a year and for TestFlight). Connect the iPhone, select it at the top and press
**Run**. On the iPhone, allow the developer under **Settings → General → VPN & Device
Management** the first time.

## Limits

iPhone stops apps shortly after you leave them, so a large first backup needs Talon to
stay open; the screen stays on while it runs. Later backups only send the new photos.
