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

## Install it from Windows (sideloading)

Download the unsigned app: **https://github.com/claudeailab/Talon/releases/download/ios-app/Talon.ipa**
(rebuilt by GitHub each time the app changes).

Open it with a sideloading tool such as **Sideloadly** (Windows or Mac), connect the
iPhone with a cable, sign in with your Apple ID and start. A free Apple ID keeps the app
working for 7 days; sideload it again to renew. On the iPhone, trust your Apple ID under
**Settings → General → VPN & Device Management**, and on iOS 16 or later turn on
**Settings → Privacy & Security → Developer Mode**.

## Install it from a Mac with Xcode

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

## Behind Cloudflare

- **Cloudflare Tunnel without Access:** enter the public address, e.g.
  `https://nas.example.com`. Cloudflare's certificate is trusted automatically.
- **With Cloudflare Access** (a sign-in page before Talon), either:
  - **Sign in with Cloudflare:** the app opens Cloudflare's sign-in page (email code,
    Microsoft, …) when it is needed and keeps the sign-in until it expires (the
    session duration of the Access application). It asks again after that.
  - **Service token** (best for photo backups): in Cloudflare Zero Trust, **Access →
    Service Auth → Create service token**. On the Access application of your NAS add a
    policy with action **Service Auth** that includes the token. In the app, paste the Client ID and secret under **Settings → Add service token**.
- Cloudflare's free plan accepts at most **100 MB per upload**, so very large videos
  only back up at home, over the NAS's own address.
