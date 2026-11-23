/* The user guide shown on the Documentation page.
 *
 * Text supports **bold** (names of buttons, fields and pages), `code` and [links](/path)
 * to pages in Talon or to other topics (/documentation?topic=<id>). Screenshots live in
 * frontend/public/guide/<name>.webp. Keep wording identical to the interface. */

export type Block =
  | { p: string }
  | { steps: string[] }
  | { list: string[] }
  | { img: string; alt: string }
  | { tip: string }
  | { warn: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Topic {
  id: string;
  title: string;
  summary: string;
  group: "Basics" | "Storage" | "Sharing" | "Cloud and alerts" | "System";
  page?: { to: string; label: string };
  before?: string[];
  sections: Section[];
}

const t = (x: string) => `/documentation?topic=${x}`;

export const GUIDE: Topic[] = [
  // ------------------------------------------------------------ Basics
  {
    id: "start",
    title: "Getting started",
    group: "Basics",
    summary: "What Talon does and the order in which to set it up.",
    sections: [
      {
        id: "what",
        title: "What Talon does",
        blocks: [
          { p: "Talon turns this computer into a NAS: a file server for your home or office. It combines disks into a RAID array, creates volumes on them, and shares folders with Windows, macOS, Linux, iPhone and Android over the network." },
          { p: "Everything is done in this web interface. You never need the command line." },
        ],
      },
      {
        id: "order",
        title: "Set up in this order",
        blocks: [
          {
            steps: [
              "Check your disks on the [Disks](/disks) page. See [Disks and health](" + t("disks") + ").",
              "Optional: combine two or more disks into a RAID array on the [RAID](/raid) page, so a failed disk loses no data. See [RAID](" + t("raid") + ").",
              "Create a volume on the RAID array or on a single disk on the [Volumes](/volumes) page. See [Volumes](" + t("volumes") + ").",
              "Add an account for each person on the [Users & Groups](/users) page. See [Users & Groups](" + t("users") + ").",
              "Create shared folders and choose who may use them on the [Shared Folders](/shares) page. See [Shared Folders](" + t("shares") + ").",
              "Connect from your computers and phones. See [Connect from your devices](" + t("connect") + ").",
            ],
          },
          { tip: "Optional extras: email alerts ([Email notifications](" + t("email") + ")) and OneDrive backup ([OneDrive](" + t("onedrive") + "))." },
        ],
      },
      {
        id: "signin",
        title: "Signing in",
        blocks: [
          { p: "Open the address the installer shows at the end in a browser, for example **https://192.168.1.50/** or **https://<hostname>.local/**." },
          { p: "The installer shows how to sign in when it finishes:" },
          {
            list: [
              "Installed as **root**: it creates the administrator **nasadmin** with a random password and shows both, for example `Administrator login: nasadmin / Xy7…`. Change this password in [Users & Groups](/users) after signing in.",
              "Installed from your own account (asked for your password to get root access): that account is the administrator; sign in with its user name and Linux password.",
            ],
          },
          { p: "People from your organization's EntraID can also sign in with their Microsoft account. See [Users & Groups](" + t("users") + ")." },
          { p: "Other people can sign in once they are marked as **Administrator** on the [Users & Groups](/users) page." },
          { p: "The first time, the browser warns that the connection is not private. This is expected: Talon uses its own certificate. Choose **Advanced** and continue to the site. (With HTTPS turned off in [Settings → Networking](/settings?tab=network), the address starts with http:// and there is no warning.)" },
        ],
      },
      {
        id: "menu",
        title: "The account menu",
        blocks: [
          { p: "Click your name at the bottom of the menu to **Log out**, **Restart** or **Shut down** the NAS. The moon and sun button switches between dark and light mode." },
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    group: "Basics",
    summary: "Live status of the system, storage, disks and services.",
    page: { to: "/", label: "Open Dashboard" },
    sections: [
      {
        id: "overview",
        title: "What the dashboard shows",
        blocks: [
          { img: "dashboard", alt: "Dashboard" },
          {
            list: [
              "**CPU, Memory, Network and Disk activity**: live values and the last few minutes as a chart. Tap a card for its history.",
              "**Storage**: each volume with its free space, each RAID array with its health and disks and, when turned on, OneDrive.",
              "**System**: model, operating system, kernel, processor, memory, uptime, network addresses, and the number of shared folders and users.",
              "**Disks**: every disk with its health and temperature.",
              "**Services**: which network services are running.",
            ],
          },
          { p: "The badge at the top says **All systems healthy**, or how many issues need attention. Each issue appears as a card above the charts; click it to go to the page where you can fix it." },
          { p: "**History**: tap the CPU, Memory, Network or Disk activity card, or **History** on the Storage card, to see the last hour, 24 hours, 7 days, 30 days or year, with the average and the peak. Disk activity also shows each disk's temperature; Storage shows how fast each volume grows and when it will be full. Talon keeps a year of history, about 1 MB." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Storage
  {
    id: "disks",
    title: "Disks and health",
    group: "Storage",
    summary: "Disk health (S.M.A.R.T.), temperature, self-tests and wiping.",
    page: { to: "/disks", label: "Open Disks" },
    sections: [
      {
        id: "health",
        title: "Disk health",
        blocks: [
          { img: "disks", alt: "Disks page" },
          { p: "Every disk shows its type (HDD, SSD, NVMe, USB), size, what it is used for, health and temperature. Choose **S.M.A.R.T. details** in a disk's **⋯** menu for its power-on time, bad sectors, wear and every attribute." },
          { p: "Virtual disks and some USB enclosures do not report health; they show what they are used for instead." },
          { p: "Talon counts sizes like Windows and OneDrive (1 TB = 1024 GB), so its numbers match File Explorer. Disk makers count 1 TB = 1000 GB, so a 4 TB disk shows as 3.6 TB." },
        ],
      },
      {
        id: "tests",
        title: "Self-tests",
        blocks: [
          { p: "In **S.M.A.R.T. details**, click **Run short test** (a few minutes) or **Run extended test** (several hours). The result appears in the **Self-test log**." },
        ],
      },
      {
        id: "wipe",
        title: "Wipe a disk",
        blocks: [
          { p: "**Wipe disk** in a disk's **⋯** menu removes old partitions and RAID information, so the disk can be used for a new RAID array or volume." },
          { warn: "Everything on the disk is lost. Disks that belong to one of Talon's RAID arrays or volumes cannot be wiped." },
          { p: "**Foreign RAID** means the disk belongs to a RAID array from another system. Wipe it, or select it directly when you create a RAID array or volume: Talon stops the old array first, then erases the disk. Its other disks then show **Has data** and can be used the same way. A foreign array that is mounted or in use is left alone." },
          { tip: "USB disks work, but can disconnect under load. For RAID, use SATA or NVMe disks, or a powered USB hub." },
        ],
      },
    ],
  },
  {
    id: "raid",
    title: "RAID",
    group: "Storage",
    summary: "Combine disks into one array",
    page: { to: "/raid", label: "Open RAID" },
    sections: [
      {
        id: "levels",
        title: "Which RAID level to choose",
        blocks: [
          { p: "A RAID array combines several disks into one. Depending on the level, it keeps working when a disk fails." },
          {
            list: [
              "**RAID 0 (stripe)**: fastest and full capacity, but one failed disk loses everything. 2 or more disks.",
              "**RAID 1 (mirror)**: every disk holds the same data. Survives all but one disk failing. Capacity of one disk. 2 or more disks.",
              "**RAID 5 (single parity)**: survives one disk failure. Capacity of all disks but one. 3 or more disks. Recommended for most homes.",
              "**RAID 6 (double parity)**: survives two disk failures. Capacity of all disks but two. 4 or more disks.",
              "**RAID 10 (striped mirrors)**: fast, survives one failure per mirror pair. Half the capacity. 4 or more disks.",
            ],
          },
          { tip: "Use disks of the same size. In a RAID, every disk only contributes as much as the smallest one; Talon shows how much capacity would be unused." },
          { warn: "RAID protects against a failed disk, not against deleted files, ransomware or fire. Keep a separate backup, for example with [OneDrive](" + t("onedrive") + ")." },
        ],
      },
      {
        id: "create",
        title: "Create a RAID array",
        blocks: [
          {
            steps: [
              "On the [RAID](/raid) page, click **Create RAID**.",
              "**Disks**: select at least two unused disks and click **Continue**.",
              "**RAID level**: pick a level. Each card shows the usable capacity, how many disk failures it survives and its speed. Click **Continue**.",
              "**Confirm**: check the **RAID name** (you can change it), type it again to confirm, then click **Erase disks & create**.",
            ],
          },
          { img: "raid-create", alt: "Create RAID: selecting disks" },
          { warn: "All data on the selected disks is erased." },
          { p: "The array synchronises in the background, which can take several hours on large disks. You can already create a volume on it and use it while it does." },
          { p: "Next step: create a volume on the array. See [Volumes](" + t("volumes") + ")." },
        ],
      },
      {
        id: "manage",
        title: "Look after an array",
        blocks: [
          { img: "raid", alt: "RAID page" },
          { p: "Open the **⋯** menu of an array for these actions:" },
          {
            list: [
              "**Add disk**: add a disk as a **Hot spare** (stands by and automatically replaces a failing disk), to **Expand capacity** (RAID 5 and RAID 6) or to **Add mirror** (RAID 1). RAID 0 and RAID 10 arrays cannot be extended, and RAID 0 has no hot spares.",
              "**Replace failed disk**: shown instead of **Add disk** when the array is degraded; rebuilds the missing data onto a new disk.",
              "**Run data scrub**: reads every block on every disk. A sector that cannot be read is rewritten from the other disks before it causes trouble in a rebuild. Running one every month or two is good practice. **Stop data scrub** stops it. Not available for RAID 0.",
              "**Delete RAID**: only possible after its volume is deleted.",
            ],
          },
          { p: "To take a disk out of an array, point at it under **Member disks** and click its remove button. Talon refuses when the array would not survive it." },
          { p: "After **Expand capacity** finishes, use **Expand filesystem** on the [Volumes](/volumes) page so the volume can use the new space." },
        ],
      },
      {
        id: "failed",
        title: "When a disk fails",
        blocks: [
          {
            steps: [
              "The array shows **Degraded** and the dashboard shows an alert. With [Email notifications](" + t("email") + ") you also get an email.",
              "Shut down the NAS from the account menu and replace the failed disk with one of at least the same size.",
              "Open the array's **⋯** menu, choose **Replace failed disk** and select the new disk.",
              "The array shows **Rebuilding** with a progress bar. It is protected again when it shows **Healthy**.",
            ],
          },
          { tip: "With a **Hot spare**, the rebuild starts by itself as soon as a disk fails." },
        ],
      },
    ],
  },
  {
    id: "volumes",
    title: "Volumes",
    group: "Storage",
    summary: "Format a RAID array or a single disk so it can store files.",
    page: { to: "/volumes", label: "Open Volumes" },
    sections: [
      {
        id: "create",
        title: "Create a volume",
        blocks: [
          {
            steps: [
              "On the [Volumes](/volumes) page, click **Create volume**.",
              "Pick a RAID array or a single unused disk.",
              "Enter a **Volume name**, for example volume1. It is mounted at /srv/nas/<name>.",
              "Choose a **Filesystem**: **ext4** (recommended Linux default) or **XFS** (for very large files).",
              "Click **Create volume** (for a single disk: **Erase disk & create**).",
            ],
          },
          { img: "volume-create", alt: "Create volume" },
          { warn: "A single disk is erased when a volume is created on it." },
        ],
      },
      {
        id: "use",
        title: "Use and manage volumes",
        blocks: [
          { img: "volumes", alt: "Volumes page" },
          {
            list: [
              "Each volume shows its used and free space and whether it survives disk failures.",
              "**⋯ → Browse files** opens the volume on the [Browser](/browser) page.",
              "**Expand filesystem** appears after the RAID array under the volume has grown.",
              "**Delete volume** erases everything on it.",
            ],
          },
          { p: "Next step: share folders on the volume. See [Shared Folders](" + t("shares") + ")." },
        ],
      },
    ],
  },

  {
    id: "files",
    title: "Browser",
    group: "Storage",
    summary: "Browse, upload and download files on volumes, other disks and OneDrive.",
    page: { to: "/browser", label: "Open Browser" },
    sections: [
      {
        id: "browse",
        title: "Browse",
        blocks: [
          { img: "files", alt: "Browser page" },
          {
            list: [
              "Choose where to browse with the button at the top left: your **Volumes**, **Other disks** (USB disks and other disks with a filesystem that are not part of a volume or RAID) and **OneDrive** when it is connected.",
              "Click once to select an item, double-click a folder to open it. On a phone or tablet, tap a folder to open it and use the checkboxes to select.",
              "Use the folder path next to the location to go back up (choose the location again to return to its top), and **Filter this folder** to find a name.",
              "Hidden items whose names start with a dot are not shown. Earlier copies and deleted files are under **Previous versions** and **Recycle bin**.",
            ],
          },
        ],
      },
      {
        id: "disks",
        title: "USB and other disks",
        blocks: [
          { p: "A disk with FAT32, exFAT, NTFS, ext4, XFS or Btrfs is opened the first time you choose it. Files on FAT32, exFAT and NTFS disks belong to the NAS users group." },
          { p: "Before unplugging it, click **Eject**. Talon writes any remaining data and closes the disk. A disk that was opened outside Talon has no Eject button." },
          { tip: "While a disk is open it cannot be used for a new RAID array or volume. Eject it first." },
        ],
      },
      {
        id: "onedrive",
        title: "OneDrive",
        blocks: [
          { p: "With [OneDrive](" + t("onedrive") + ") connected, **OneDrive** appears under **Cloud**. You can browse, upload, download, create folders, rename, move within OneDrive and delete. Deleted items go to the OneDrive recycle bin." },
          { p: "Moving files between OneDrive and the NAS is not possible on this page: download and upload them, or create a OneDrive task." },
        ],
      },
      {
        id: "restore",
        title: "Previous versions and the recycle bin",
        blocks: [
          {
            list: [
              "**Previous versions**: in a file's **⋯** menu. When a backup from OneDrive replaced the file, the old copies are listed with their date. **Download** one, or **Restore** it: the current file then becomes a previous version, so nothing is lost.",
              "**Recycle bin**: the button above the file list of a volume. It lists files deleted on this page, from Windows or macOS (in shared folders with the recycle bin turned on) and by a OneDrive task (a backup from OneDrive or a two-way sync), with where they were, who deleted them and when. Select files and click **Restore**, or **Restore** one; a file whose name is taken again is restored as \"name (restored)\". **Empty recycle bin** deletes everything in it for good.",
            ],
          },
          { p: "Both keep files for 30 days, then remove them for good." },
          { p: "Not kept by Talon: files deleted on USB and other disks outside a volume, over NFS, by scheduled scripts or on the NAS's command line. Files deleted in OneDrive go to the OneDrive recycle bin." },
        ],
      },
      {
        id: "upload",
        title: "Upload and download",
        blocks: [
          {
            list: [
              "**Upload**: click **Upload**, or drag files from your computer onto the list. Progress is shown at the bottom right.",
              "**Download**: select files and click **Download**. Several items or a folder download as one zip file.",
            ],
          },
        ],
      },
      {
        id: "organise",
        title: "Organise",
        blocks: [
          {
            list: [
              "**New folder** creates a folder here.",
              "Select items to **Rename**, **Move** (choose the destination, then **Move here**) or **Delete** them.",
            ],
          },
          { p: "**Move** works between your volumes and other disks; on OneDrive it moves within OneDrive." },
          { p: "**Delete** on a volume moves the items to its **Recycle bin** for 30 days; folders go with everything inside them. On OneDrive they go to the OneDrive recycle bin." },
          { warn: "USB and other disks outside a volume have no recycle bin: delete there is permanent." },
        ],
      },
      {
        id: "folder-permissions",
        title: "Folder permissions",
        blocks: [
          { p: "A folder inside a shared folder can have its own permissions, for example a **Salaries** folder inside **Finance** that only the management group may open." },
          {
            steps: [
              "In a folder's **⋯** menu, choose **Permissions**.",
              "Choose **Custom**. On the **Users** and **Groups** tabs, give **Read** or **Read & write** to the people who may open it; everyone else gets **No access**.",
              "Click **Save**. The permissions apply to the folder and everything in it, including files added later.",
            ],
          },
          { p: "Folders with custom permissions show a **Custom** badge. People also need access to the shared folder, and get the lower of the two; each row shows what the shared folder gives them. **Same as the shared folder** removes the custom permissions." },
          { p: "Folder permissions apply over SMB and WebDAV. NFS clients cannot open folders with custom permissions." },
        ],
      },
    ],
  },
  // ------------------------------------------------------------ Sharing
  {
    id: "shares",
    title: "Shared Folders",
    group: "Sharing",
    summary: "Make folders available on your network and choose who may use them.",
    page: { to: "/shares", label: "Open Shared Folders" },
    before: ["A volume. See [Volumes](" + t("volumes") + ")."],
    sections: [
      {
        id: "create",
        title: "Create a shared folder",
        blocks: [
          {
            steps: [
              "On the [Shared Folders](/shares) page, click **New share**.",
              "**General**: enter the **Name** that people see on the network, pick the **Volume** and optionally a **Description**. A folder with this name is created on the volume.",
              "**Permissions**: **Guests** (anyone on the network, without a password) can get **Read** at most. Below are two tabs: **Users** and **Groups** (with **All NAS users** at the top). Give each **No access**, **Read** or **Read & write**. Search and **Only with access** help with many users. Someone with access directly and through a group gets the higher of the two.",
              "**SMB**: for Windows, macOS, Linux, Android and iOS. On by default. Options below.",
              "**NFS**: for Linux, Kodi, VMware ESXi and Proxmox. Options below. Turn on the **NFS** service under [Services](/services) first.",
              "Click **Create share**.",
            ],
          },
          { img: "share-permissions", alt: "Shared folder permissions" },
        ],
      },
      {
        id: "smb",
        title: "SMB options",
        blocks: [
          {
            list: [
              "**Visible in network browsing**: when off, people must type the share name to connect.",
              "**Recycle bin**: on for new shared folders. Files deleted from Windows or macOS are kept for 30 days; restore them in [Browser → Recycle bin](" + t("files") + "). Not available together with **Time Machine backups**, which removes old backups itself.",
              "**Time Machine backups**: advertises the share as a macOS Time Machine destination. Use a separate shared folder for it.",
            ],
          },
        ],
      },
      {
        id: "nfs",
        title: "NFS options",
        blocks: [
          {
            list: [
              "**Allowed clients**: add each computer's address or network (for example 192.168.1.0/24) with **Read** or **Read & write**.",
              "**User mapping**: **Map all users to the NAS users group** is the simplest and recommended choice.",
              "**Allow unprivileged source ports**: only needed by some clients, such as macOS.",
            ],
          },
        ],
      },
      {
        id: "delete",
        title: "Edit or delete",
        blocks: [
          { img: "shares", alt: "Shared folders page" },
          { p: "Use **Edit** to change permissions or options. The volume of an existing share cannot be changed. **Delete share** stops sharing the folder; its files are kept on the volume." },
        ],
      },
    ],
  },
  {
    id: "connect",
    title: "Connect from your devices",
    group: "Sharing",
    summary: "Open shared folders from Windows, macOS, Linux, iPhone and Android.",
    before: ["A shared folder and a user with access to it. See [Shared Folders](" + t("shares") + ")."],
    sections: [
      {
        id: "windows",
        title: "Windows",
        blocks: [
          {
            steps: [
              "Open File Explorer and type **\\\\<hostname>** or **\\\\<NAS IP address>** in the address bar, then press Enter. The NAS also appears under **Network**.",
              "Sign in with your NAS user name and password.",
              "To get a drive letter, right-click a shared folder and choose **Map network drive**.",
            ],
          },
        ],
      },
      {
        id: "mac",
        title: "macOS",
        blocks: [
          {
            steps: [
              "In Finder, choose **Go → Connect to Server**.",
              "Enter **smb://<hostname>.local** and click **Connect**. The NAS also appears under **Network** in the Finder sidebar.",
              "Sign in with your NAS user name and password and pick the shared folders.",
            ],
          },
          { p: "Time Machine: open **System Settings → General → Time Machine**, click **Add Backup Disk** and pick the shared folder with **Time Machine backups** turned on." },
        ],
      },
      {
        id: "iphone",
        title: "iPhone and iPad",
        blocks: [
          {
            steps: [
              "Open the **Files** app, tap **⋯** at the top, then **Connect to Server**.",
              "Enter **smb://<NAS IP address>** and tap **Connect**.",
              "Choose **Registered User** and sign in with your NAS user name and password.",
            ],
          },
          { p: "To copy photos, select them in **Photos**, tap Share, choose **Save to Files** and pick the NAS." },
        ],
      },
      {
        id: "android",
        title: "Android",
        blocks: [{ p: "Use a file manager with SMB support, add a network location with the NAS IP address and sign in with your NAS user name and password." }],
      },
      {
        id: "linux",
        title: "Linux",
        blocks: [
          { p: "SMB: in the file manager, open **smb://<NAS IP address>/**." },
          { p: "NFS: add the computer under **Allowed clients** of the share, then run: `sudo mount -t nfs <NAS IP address>:/srv/nas/<volume>/<share> /mnt/<share>`" },
        ],
      },
      {
        id: "webdav",
        title: "WebDAV (apps and remote access)",
        blocks: [
          { p: "WebDAV makes the shared folders available over HTTPS, the same address as this web interface followed by **/dav/**. It works where SMB cannot, for example from a phone outside your home through a Cloudflare tunnel, and with photo backup apps and file managers that support WebDAV." },
          {
            steps: [
              "On the [Services](/services) page, turn on **WebDAV** and click **Copy address**.",
              "In the app, add a WebDAV server with that address and your Talon user name and password.",
            ],
          },
          { p: "You see the shared folders you have access to, with the same **Read** or **Read & write** permissions as over SMB. Deleted files go to the shared folder's recycle bin when it is on. EntraID users cannot use WebDAV: Talon does not know their password." },
          { warn: "Through Cloudflare's free plan, a single upload can be at most 100 MB, so very large videos may fail to upload. Over your home network there is no limit." },
        ],
      },
    ],
  },
  {
    id: "users",
    title: "Users & Groups",
    group: "Sharing",
    summary: "Accounts for shared folders and for this web interface.",
    page: { to: "/users", label: "Open Users & Groups" },
    sections: [
      {
        id: "users",
        title: "Add a user",
        blocks: [
          {
            steps: [
              "On the [Users & Groups](/users) page, click **Add user**.",
              "Enter a **User name**, optionally a **Full name**, and a **Password** twice. This password is also used to open shared folders.",
              "Turn on **Administrator** only for people who should manage the NAS in this web interface.",
              "Click **Create user**, then give the user access on the [Shared Folders](/shares) page.",
            ],
          },
          { img: "users", alt: "Users and groups" },
          { p: "In a user's **⋯** menu you can **Edit** them (name and password), **Disable** or **Enable** them and **Delete** them. Files a deleted user created stay on the volumes." },
          { p: "At least one user must always be able to sign in to the web interface: a local administrator or an EntraID user with web access. The sign-in page shows the user name and password only while an enabled local administrator exists." },
        ],
      },
      {
        id: "groups",
        title: "Groups",
        blocks: [
          { p: "A group gives a team access to shared folders at once, instead of one user at a time." },
          {
            steps: [
              "On the [Users & Groups](/users) page, open **Groups** and click **Add group**.",
              "Enter a **Name** (lowercase, for example accounting) and optionally a **Description**.",
              "Tick the **Members**. Search helps with many users.",
              "Click **Create group**, then give the group access under a shared folder's **Permissions → Groups**.",
            ],
          },
          { p: "Click a group to change its description and members. **Delete** removes the group; its members stay but lose the access they had through it. Only local users can be members: EntraID users cannot open shared folders." },
        ],
      },
      {
        id: "entra-users",
        title: "EntraID Users",
        blocks: [
          { p: "Once the [EntraID](" + t("entra") + ") app is set up for your organization, the page also has an **EntraID Users** tab." },
          {
            steps: [
              "Open **EntraID Users** and click **Add EntraID users**.",
              "Search your organization's directory, tick the people you want and click **Add**. They can now sign in to this web interface with **Sign in with Microsoft** and manage the NAS.",
              "To take away someone's access without removing them, choose **Edit** in their **⋯** menu and turn off **Web interface**.",
            ],
          },
          { p: "Their name and password stay in EntraID and cannot be changed in Talon. **Remove** takes away their access to Talon; their EntraID account is not changed." },
          { p: "Once an EntraID user has web access, you can disable the local administrator: the sign-in page then shows only **Sign in with Microsoft**. Enable a local administrator again and the user name and password come back." },
          { warn: "Locked out (for example the client secret expired)? On the NAS, run `sudo talon enable-local-login`. It enables the local administrators again." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Cloud and alerts
  {
    id: "backup",
    title: "Backup",
    group: "Cloud and alerts",
    summary: "Copy shared folders to a USB or internal disk when you plug it in or every day, with earlier versions.",
    page: { to: "/backup", label: "Open Backup" },
    sections: [
      {
        id: "create",
        title: "Create a backup",
        blocks: [
          { p: "RAID keeps the NAS running when a disk fails, but it is not a backup. A copy on another disk protects against deleted files and a broken array; a USB disk you keep elsewhere also protects against ransomware, theft or a broken NAS." },
          {
            steps: [
              "Plug in a USB disk, or use an internal disk (SATA or NVMe) that has a filesystem and is not used by a volume. On the [Backup](/backup) page, click **New backup**.",
              "**Disk**: choose the disk. Each disk shows its type, for example **USB disk** or **SATA hard disk**.",
              "**Folders**: keep **All shared folders** or choose some.",
              "**When**: **Whenever I plug in the disk**, **Every day** at a time you choose, or both. Turn on **Eject the disk when done** to unplug it safely afterwards, and choose how long to **Keep earlier versions**.",
              "**Name**: check the summary and click **Create and back up now**.",
            ],
          },
          { p: "The disk is recognised wherever you connect it. Backups are in the folder **Talon Backup** on the disk, as normal files that any computer can open. You get an email when a backup completes or fails." },
        ],
      },
      {
        id: "versions",
        title: "Versions and restoring",
        blocks: [
          { p: "On disks formatted as ext4, XFS, Btrfs or NTFS, every backup is a dated version; files that did not change take no extra space. Versions older than the number of days you chose are removed, and the newest is always kept. FAT32 and exFAT cannot do this: there the backup is one copy, kept up to date." },
          { p: "**Restore** lists the versions. Choosing one opens it in [Browser](/browser), where you can download a file or move it back to a volume." },
          { p: "**⋯ → Edit** changes the folders or the schedule; **Delete** removes the backup task but keeps the backups on the disk." },
        ],
      },
    ],
  },
  {
    id: "onedrive",
    title: "OneDrive",
    group: "Cloud and alerts",
    summary: "Back up or sync folders between this NAS and Microsoft OneDrive.",
    page: { to: "/onedrive", label: "Open OneDrive" },
    before: [
      "A Microsoft Entra ID app, set up once in **Settings → EntraID**. See [EntraID](" + t("entra") + "). OneDrive cannot sign in without it.",
      "The **OneDrive** service turned on in [Services](/services).",
    ],
    sections: [
      {
        id: "setup",
        title: "Set up OneDrive",
        blocks: [
          {
            steps: [
              "Set up the EntraID app and click **Test** until it passes. See [EntraID](" + t("entra") + ").",
              "On the [Services](/services) page, turn on **OneDrive**. Talon downloads the transfer tool (rclone) and opens the OneDrive page.",
              "Click **Sign in with Microsoft**, sign in and allow access to your files. You return to Talon, which shows the account as **Connected**.",
              "Click **New task** to create your first backup.",
            ],
          },
          { img: "onedrive", alt: "OneDrive page" },
        ],
      },
      {
        id: "task",
        title: "Create a task",
        blocks: [
          { img: "onedrive-task", alt: "New OneDrive task" },
          { p: "Click **New task**. A short wizard asks one question per step:" },
          {
            steps: [
              "**What do you want to do?** **Back up OneDrive to the NAS**, **Back up the NAS to OneDrive**, or **Keep both the same** (beta: changes on either side go to the other; folders only; a file changed on both sides is kept twice, one copy renamed).",
              "**Which folders?** Click **Change** to pick the OneDrive folder and the NAS folder. Click once to select, click **›** (or double-click) to open a folder, or use **New folder**. A backup can also copy a single file.",
              "**When should it run?** **Every day** at a set time, **Every few hours** (every 15 minutes up to every 12 hours), or **Only when I start it**.",
              "**How carefully should Talon check?** **Don't check**, **Quick check** (recommended) or **Full check**, plus an optional full check every week or every month. See [Run and check tasks](" + t("onedrive") + ").",
              "**Almost done**: check the summary and the **Name**, then click **Create task**.",
            ],
          },
          {
            list: [
              "**Delete on Talon what I delete on OneDrive** (or **Delete on OneDrive what I delete on Talon** for a backup to OneDrive): when a file is deleted on one side it is also deleted on the other. Off means nothing is ever deleted (safer).",
              "When a backup from OneDrive replaces or deletes a file on the NAS, the old copy is kept for 30 days. Restore it from **Previous versions** or the **Recycle bin** in [Browser](" + t("files") + "). A two-way sync keeps them the same way. A backup to OneDrive needs no copy of its own: OneDrive keeps earlier versions of its files.",
              "**More options**: **If it fails** (try a failed run again up to 5 times, 2 minutes apart) and a **Speed limit**, so backups do not slow down your internet.",
            ],
          },
          { p: "To change a task, choose **Edit** in its **⋯** menu. It opens a summary of the task; click **Change** next to a part, adjust it, click **Done**, then **Save**." },
        ],
      },
      {
        id: "run",
        title: "Run and check tasks",
        blocks: [
          { p: "Each task shows its schedule, last run and status. Use **Run now** to start it, **Stop** to cancel it, and the **⋯** menu to edit it, view its log or delete it. Deleting a task does not touch any files." },
          { p: "A running task first shows **Comparing** while it checks which files OneDrive and the NAS already have in common, then **Copying** with the share of files that are done and the size left to copy. Files already up to date count as done." },
          { p: "Under the progress bar, **Working** shows rclone is making progress. It turns amber when OneDrive limits requests (throttling) or nothing has changed for a minute; rclone keeps trying by itself." },
          { p: "After each run Talon checks that every file arrived, as chosen in the wizard. **Quick check** compares names and sizes and takes about as long as the comparison. **Full check** also compares the contents by checksum, reading every file on the NAS once; OneDrive's checksums are read without downloading anything. Each option shows how long it takes for this task, from its file count, its size and the measured read speed of your disks." },
          { p: "Files that are missing or different are copied again automatically and checked once more. The log window shows the result; only files that still do not match are listed, and you get an email about them when notifications are on. **Also a full check** adds a weekly or monthly full check, and **Quick check now** and **Full check now** in a task's **⋯** menu check at any time without copying." },
          { p: "**View log** shows the same progress bar, plus each step with its time and keeps the newest line in view while the task runs; scroll up to read earlier lines." },
          { p: "If Talon or the NAS restarts while a task runs, the task continues by itself shortly after Talon starts again; files already copied are skipped." },
          { p: "**Disconnect** signs out of Microsoft. Tasks stop running until you sign in again; no files are deleted." },
          { tip: "With [Email notifications](" + t("email") + ") you get an email when a OneDrive task fails." },
        ],
      },
    ],
  },
  {
    id: "entra",
    title: "EntraID (Microsoft sign-in)",
    group: "Cloud and alerts",
    summary: "The one-time Microsoft app registration that OneDrive, and signing in with Microsoft, need.",
    page: { to: "/settings?tab=entra", label: "Open Settings → EntraID" },
    sections: [
      {
        id: "why",
        title: "Why it is needed",
        blocks: [
          { p: "Microsoft only lets registered apps sign in to OneDrive. You register your own free app in Microsoft Entra ID, so your files are only reachable by your NAS and nobody else's. It takes about 5 minutes and works with personal and work accounts." },
        ],
      },
      {
        id: "steps",
        title: "Step by step",
        blocks: [
          { p: "Talon shows the same steps under **Settings → EntraID → Setup guide**, with your exact redirect address and a **Copy** button. Talon needs three values from the app: the **Application (client) ID**, the **Directory (tenant) ID** and a **client secret**. It works out by itself which accounts the app allows." },
          {
            steps: [
              "**Open the Entra admin center**: go to **entra.microsoft.com** and sign in.",
              "**Register the app**: **App registrations → New registration**, name it **Talon**. Supported account types: **Any Entra ID Tenant + Personal Microsoft accounts**. Redirect URI: platform **Web**, paste the address from Talon's **Redirect URI** field, then click **Register**.",
              "**Copy the two IDs**: from the **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID** into Talon.",
              "**Add the permissions**: **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add **Files.ReadWrite** and **offline_access** (allows OneDrive sync). Then **API permissions → Add a permission → Microsoft Graph → Application permissions**, add **User.Read.All** (allows [EntraID users](" + t("users") + ") to access the Talon web interface). Click **Grant admin consent**.",
              "**Create a client secret**: **Certificates & secrets → New client secret**, expiry **24 months**. Copy the secret **Value** (not the Secret ID) into Talon. It is shown once. In Talon, enter its **Expires** date under **Secret expires on**.",
              "**Save and test in Talon**: click **Save**, then **Test**.",
            ],
          },
          { img: "entra-guide", alt: "EntraID setup guide" },
        ],
      },
      {
        id: "test",
        title: "If the test fails",
        blocks: [
          {
            list: [
              "**Redirect URI**: it must match the address you use to open Talon exactly, including https:// and the name or IP address. Using several addresses? Add each one's redirect URI in Entra.",
              "**Client secret**: paste the secret **Value**, not the Secret ID. Expired secrets must be replaced with a new one.",
              "**Accounts**: shows which accounts can connect OneDrive. If yours cannot, change **Supported account types** in the Entra portal (see step 2), then click **Save** in Talon again.",
            ],
          },
          { warn: "Client secrets expire (after 24 months with the recommended setting). Create a new one in Entra before then and save it in Talon, or OneDrive tasks stop." },
        ],
      },
      {
        id: "expiry",
        title: "Get reminded before the secret expires",
        blocks: [
          {
            steps: [
              "In [Settings → EntraID](/settings?tab=entra), under **Client secret expiry**, enter the date in **Secret expires on**. Entra shows it under **Certificates & secrets**.",
              "Choose when to **Send a reminder**: 7 to 90 days before.",
              "Enter the addresses in **Send the reminder to**, separated by commas. Leave it empty to use the recipients from the [Notifications](/notifications) page.",
              "Click **Save**.",
            ],
          },
          { img: "settings-entra", alt: "EntraID settings with the client secret expiry" },
          { p: "Talon sends one email when the reminder period starts and one more if the secret expires. The dashboard also shows the expiry as an issue. Emails need [SMTP](" + t("email") + ") to be set up." },
          { p: "After you create a new secret, paste its Value and its new expiry date and click **Save**; the reminders start again for the new date." },
        ],
      },
      {
        id: "sso",
        title: "EntraID Users and Sign in with Microsoft",
        blocks: [
          { p: "People from your organization can use Talon and sign in with their Microsoft account. See [EntraID Users](" + t("users") + "). It needs the **Application permission** **User.Read.All** with **Grant admin consent** (step 5 above); **Test** then shows **Directory users** as passed." },
          { tip: "Open Talon at the same address as the **Redirect URI** you registered. A different address (for example a Cloudflare domain) needs its own Redirect URI in the Entra portal." },
        ],
      },
    ],
  },
  {
    id: "email",
    title: "Email notifications",
    group: "Cloud and alerts",
    summary: "Get an email when a disk, RAID array or task needs attention.",
    page: { to: "/notifications", label: "Open Notifications" },
    before: ["An email account that allows SMTP, set up in **Settings → SMTP**."],
    sections: [
      {
        id: "smtp",
        title: "1. Set up SMTP",
        blocks: [
          {
            steps: [
              "Open [Settings → SMTP](/settings?tab=smtp).",
              "Enter the **SMTP server** and **Port** from your email provider, and the **Connection security**: **STARTTLS** (usually port 587), **SSL/TLS** (usually 465) or **None**.",
              "Enter the **Sender address** the emails come from.",
              "Enter the **User name** and **Password**, or leave them empty if the server needs no sign-in. Many providers require an app password here instead of your normal password.",
              "Click **Save**, then **Test**. Talon checks the connection, encryption, sign-in and sender address without sending an email.",
            ],
          },
          { img: "settings-smtp", alt: "SMTP settings" },
        ],
      },
      {
        id: "notify",
        title: "2. Choose the alerts",
        blocks: [
          {
            steps: [
              "Open the [Notifications](/notifications) page, tab **Email**.",
              "Enter one or more addresses under **Send to**, separated by commas.",
              "Under **Send an email when**, choose the events: RAID degraded or failed, disk health warning, disk too hot, volume almost full, background task failed, OneDrive task failed, software update available, and failed sign-in attempt.",
              "Click **Save**, then **Send test** to send a test email.",
            ],
          },
          { img: "notifications", alt: "Notifications" },
          { p: "Each alert is sent once, and again only if it clears and comes back." },
        ],
      },
      {
        id: "thresholds",
        title: "3. Thresholds",
        blocks: [
          { p: "On the [Notifications](/notifications?tab=thresholds) page, the **Thresholds** tab sets when Talon warns you. The limits apply to the dashboard, the bell and emails, also without SMTP." },
          {
            list: [
              "**Disk temperature**: a limit for **Hard disks (HDD)**, **SATA SSDs** and **NVMe SSDs**, because SSDs run warmer. Each shows the current temperatures of those disks.",
              "**Volume almost full**: how full a volume may get, in percent.",
              "**SSD wear**: how much of an SSD's rated write endurance may be used.",
              "**Bad sectors**: warn as soon as a disk reports reallocated or pending sectors.",
            ],
          },
          { img: "notifications-thresholds", alt: "Thresholds" },
          { p: "Change the values and click **Save**. **Reset to defaults** restores 55 °C, 65 °C and 75 °C, 90% full, 90% worn, and bad sector warnings on." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ System
  {
    id: "antivirus",
    title: "Antivirus",
    group: "System",
    summary: "Scan volumes for viruses with ClamAV, on demand or on a schedule.",
    page: { to: "/antivirus", label: "Open Antivirus" },
    sections: [
      {
        id: "install",
        title: "Install ClamAV",
        blocks: [
          { p: "Talon uses **ClamAV**, a free, open-source antivirus by Cisco Talos. It is off until you want it: on the [Services](/services) page, turn on **Antivirus**. Talon installs ClamAV and the **Antivirus** page appears in the menu. It downloads about 300 MB, including the virus definitions, with a progress bar. The virus definitions then update automatically every hour; ClamAV itself updates with the [operating system updates](" + t("settings") + ")." },
          { p: "A scan loads the virus definitions into memory while it runs, about 1.5 GB, and frees it afterwards. ClamAV needs at least 2 GB of memory and recommends 3 GB or more; Talon tells you when the NAS has too little." },
        ],
      },
      {
        id: "scan",
        title: "Scan and schedule",
        blocks: [
          {
            steps: [
              "Keep **All volumes** or choose some, then click **Scan now**. The whole volume is scanned, also folders that are not shared. A progress bar shows how many files are done; **Stop** ends the scan.",
              "Under **Scheduled scan**, choose **Daily** or **Weekly** and the time. It scans the volumes chosen above; changes save by themselves.",
            ],
          },
          { p: "Scans run at low priority, so shared folders stay responsive. A scan that finds something is in the [Activity](/activity) log and you get an email (**Virus found** in [Notifications](/notifications))." },
        ],
      },
      {
        id: "quarantine",
        title: "Quarantine",
        blocks: [
          { p: "Infected files move to the volume's quarantine, outside every shared folder, so nobody opens them by accident. In the **Quarantine** list (shown when it holds files), each file's **⋯** menu can **Delete** it for good or **Restore** it to its folder; only restore a file you are sure is a false alarm." },
          { p: "**⋯ → Remove ClamAV** uninstalls it. Files in the quarantine stay until you restore or delete them." },
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Activity",
    group: "System",
    summary: "A log of everything Talon does, and the system logs.",
    page: { to: "/activity", label: "Open Activity" },
    sections: [
      {
        id: "log",
        title: "Activity log",
        blocks: [
          { img: "activity", alt: "Activity" },
          { p: "The **Activity Log** lists everything that happens in Talon: every change made in the web interface, sign-ins, OneDrive and scheduled task runs with their results, alerts and emails, updates and restarts, with who did it and when. **Details** next to a background task, such as creating a RAID array or wiping a disk, shows each step it ran, also after a restart." },
          { p: "It also shows the **system logs**: what the operating system and its services wrote to the system journal, such as Samba, NFS, SSH, disks (S.M.A.R.T. and RAID), the kernel and Talon's own service. **Everything** shows both, newest first." },
          { p: "Choose what to show in the first list: **Everything**, **All Talon activity** or one kind of operation (for example OneDrive or Scheduled), or **All system logs** or one service (for example Samba when a computer cannot connect to a shared folder). Show **Warnings and errors** or **Errors only**, and **Search** for words. Tap an entry to read it in full; **Newer** and **Older** page through the list. The newest 20,000 Talon entries are kept." },
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings and updates",
    group: "System",
    summary: "Name, time zone, network address, Windows and macOS options, and updates of Talon and the operating system.",
    page: { to: "/settings", label: "Open Settings" },
    sections: [
      {
        id: "general",
        title: "General",
        blocks: [
          { img: "settings-general", alt: "General settings" },
          {
            list: [
              "**Hostname**: the NAS's name on the network. It is reachable as <hostname>.local.",
              "**Time zone**: used for schedules and times shown in Talon.",
              "**Date format** and **Time format**: how dates and times are shown and typed everywhere in Talon and in its emails, for example 22-11-2026 or 11/22/2026, and 17:45 or 5:45 PM.",
              "**Workgroup**: the Windows workgroup. WORKGROUP is the Windows default.",
              "**Minimum SMB protocol**: SMB2_10 or newer is recommended. Lower it only for very old devices.",
              "**macOS compatibility**: faster Finder browsing and correct metadata for Macs.",
            ],
          },
        ],
      },
      {
        id: "network",
        title: "Networking: DHCP or a static IP",
        blocks: [
          { p: "By default the NAS gets its address from your router (DHCP), so the address can change. A static IP keeps it the same." },
          {
            steps: [
              "Open [Settings → Networking](/settings?tab=network). It shows the current address, subnet mask, gateway and DNS servers.",
              "Choose **Static IP**. The fields start with the current values.",
              "Enter the **IP address**, **Subnet mask** (usually 255.255.255.0), **Gateway** (usually your router) and a **DNS server** (your router or, for example, 1.1.1.1). A **Second DNS server** is optional.",
              "Click **Save**, then **Apply**.",
              "Open Talon at the new address shown, for example https://192.168.1.60/.",
            ],
          },
          { img: "settings-network", alt: "Networking settings" },
          { warn: "Pick an address outside the range your router hands out, or reserve it in the router, so no other device gets the same address." },
          { p: "To go back, choose **Automatic (DHCP)** and click **Save**. The router may then give the NAS a different address; open it at **https://<hostname>.local/**." },
          { tip: "If Talon is not opened at its new address within 3 minutes, for example because the gateway was wrong, the previous settings come back by themselves." },
        ],
      },
      {
        id: "https",
        title: "HTTPS or plain HTTP",
        blocks: [
          { p: "Talon uses HTTPS with its own certificate. When Cloudflare (for example a Cloudflare Tunnel) or another proxy already provides HTTPS, turn Talon's off: under **Settings → Networking → Web Interface**, switch off **HTTPS** and confirm. Talon restarts and serves plain http:// on port 80; point the proxy at **http://<NAS IP address>:80**." },
          { warn: "Without HTTPS, passwords cross your network unencrypted unless the proxy adds HTTPS. Turn **HTTPS** on again to return to https:// on port 443." },
        ],
      },
      {
        id: "update",
        title: "Software updates",
        blocks: [
          { img: "settings-update", alt: "Software update" },
          { p: "Talon checks for a new version every 6 hours; change this under **Check for updates** (every hour up to every week, or **Never** to check only with **Check now**). Nothing installs by itself. When a new version is available, a button at the bottom of the menu says so. Open [Settings → Update](/settings?tab=update) and click **Install now**." },
          { p: "An update takes about 1–3 minutes. The web interface restarts and reloads by itself. Shared folders stay available and volumes are not touched. If anything fails, the previous version is restored automatically." },
        ],
      },
      {
        id: "os-update",
        title: "Operating system updates",
        blocks: [
          { p: "[Settings → Update](/settings?tab=update&os=1) has two tabs: **Talon** and **Operating system**. The operating system (Debian, Ubuntu or Raspberry Pi OS) is checked once a day; **Check now** checks straight away, with a progress bar. Security updates are listed first; **Other** shows the rest." },
          { p: "**Install all updates** installs them with a progress bar. Shared folders keep working, and configuration files you changed are kept. When an update needs a restart, for example a new Linux kernel, **Restart to finish** appears here and on the Dashboard." },
          {
            list: [
              "**Install updates automatically**: **Off**, **Security only** or **All updates**. They install every night, with an email when something was installed (set up SMTP first).",
              "**Restart automatically when needed**: only when an update needs it, at the time you choose (04:00 by default).",
            ],
          },
          { p: "Waiting security updates show on the Dashboard, and you get an email about new ones unless they install automatically." },
        ],
      },
      {
        id: "other",
        title: "EntraID, SMTP and About",
        blocks: [
          { p: "**EntraID** is the Microsoft sign-in for OneDrive ([EntraID](" + t("entra") + ")). **SMTP** sends emails ([Email notifications](" + t("email") + ")). **About** shows the Talon version and the hardware." },
        ],
      },
    ],
  },
  {
    id: "services",
    title: "Services",
    group: "System",
    summary: "The network services that make the NAS reachable.",
    page: { to: "/services", label: "Open Services" },
    sections: [
      {
        id: "list",
        title: "What each service does",
        blocks: [
          { img: "services", alt: "Services" },
          {
            list: [
              "**SMB (Samba)**: shared folders for Windows, macOS, Linux, iPhone and Android.",
              "**NetBIOS**: lets very old Windows versions find the NAS by name. Usually not needed.",
              "**NFS**: shared folders for Linux and other Unix systems.",
              "**WS-Discovery**: shows the NAS under Network in Windows File Explorer.",
              "**Bonjour (mDNS)**: shows the NAS in macOS Finder and makes **<hostname>.local** work.",
              "**SSH**: command-line access for advanced users.",
              "**OneDrive**: backup and sync with Microsoft OneDrive. See [OneDrive](" + t("onedrive") + ").",
              "**WebDAV**: shared folders over HTTPS for apps and remote access.",
              "**Antivirus**: virus scans of volumes with ClamAV. See [Antivirus](" + t("antivirus") + ").",
              "**SD-card protection**: keeps the system logs in memory and writes them to the disk once a day and when the NAS shuts down or restarts, so an SD card or USB flash drive lasts much longer. Recommended when Talon runs from one; it applies after the next restart. After a power cut, up to a day of system logs can be lost; your files are not affected. Its card shows how much is written to the disk a day and how much of it are system logs, so you can see what it would save; once it runs, it shows what it saved.",
            ],
          },
          { p: "The page lists the **Enabled** services first, then the **Disabled** ones. Turn a service on or off with its switch; it then also starts, or no longer starts, at boot. **Restart** restarts a running service." },
          { p: "After installing Talon, **NFS**, **Bonjour (mDNS)**, **OneDrive**, **WebDAV**, **Antivirus** and **SD-card protection** are off: turn on the ones you need." },
        ],
      },
    ],
  },
  {
    id: "scheduled",
    title: "Scheduled tasks",
    group: "System",
    summary: "Run commands and scripts on the NAS on a schedule.",
    page: { to: "/scheduled", label: "Open Scheduled" },
    sections: [
      {
        id: "create",
        title: "Create a task",
        blocks: [
          {
            steps: [
              "On the [Scheduled](/scheduled) page, click **New task**.",
              "Enter a **Task name** and choose **Run as**: **root** (full access to the system) or a NAS user (only that user's access).",
              "Under **What to run**, type one or more commands, one per line. They run with bash. Volumes are at /srv/nas/<volume>.",
              "Click **Test run** to try it. The output and the result appear below the commands; a test run stops after 1 minute.",
              "Choose a **Schedule**: **Manually**, every 15 minutes up to every 12 hours, **Daily**, **Weekly** or **Monthly** at a time, **At startup** (once each time the NAS starts) or **Custom (cron)**.",
              "Choose **Stop after**: the task is stopped if it runs longer than this.",
              "Click **Create task**.",
            ],
          },
          { img: "scheduled-task", alt: "New scheduled task" },
          {
            list: [
              "**Email me if it fails**: sends the last output when a run ends with an error. Uses the [Notifications](/notifications) recipients.",
              "**Skip if still running**: when a run is due while the previous one is still running, it is skipped. Off: it runs as soon as the previous one ends.",
            ],
          },
          { warn: "Tasks that run as root can change or delete anything on the NAS. Test new commands with **Test run** first." },
        ],
      },
      {
        id: "cron",
        title: "Custom (cron) schedules",
        blocks: [
          { p: "A custom schedule has five fields: minute, hour, day of the month, month and weekday (0 or 7 is Sunday). Use `*` for any value, commas for lists, `-` for ranges and `/` for steps." },
          {
            list: [
              "`0 3 * * *`: every day at 03:00.",
              "`*/10 * * * *`: every 10 minutes.",
              "`30 22 * * 1-5`: Monday to Friday at 22:30.",
              "`0 4 1 * *`: on the 1st of every month at 04:00.",
            ],
          },
        ],
      },
      {
        id: "manage",
        title: "Run, pause and check tasks",
        blocks: [
          { img: "scheduled", alt: "Scheduled page" },
          { p: "Each task shows who it runs as, its schedule, its last run and its status: **Succeeded**, **Running**, **Failed** with the exit code, **Stopped** or **Paused**. **Run now** starts it at once and **Stop** ends a running task." },
          { p: "The **⋯** menu has **Edit**, **View output** (the latest run with its full output, start time, duration and exit code; earlier runs are in the [Activity](/activity) log; each line shows when it was printed, and while a task runs it keeps the newest line in view and shows **Working**, or in amber how long the script has printed nothing), **Pause** or **Resume**, **Duplicate** and **Delete**." },
          { p: "A progress bar shows how far a running task is when the script reports it: rsync with **--info=progress2** (add **--no-inc-recursive** so the percentage covers the whole job from the start), or any script that prints a line such as **PROGRESS 45**. Those lines move the bar and are not shown in the output. Otherwise the bar moves without a percentage and shows how long the task has been running and how long the last run took." },
          { p: "Every change is recorded in [Activity](/activity)." },
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    group: "System",
    summary: "Solutions for common problems.",
    sections: [
      {
        id: "cert",
        title: "The browser says the connection is not private",
        blocks: [{ p: "Talon uses its own certificate, which browsers do not know. The connection is still encrypted. Choose **Advanced** and continue to the site." }],
      },
      {
        id: "signin",
        title: "I cannot sign in",
        blocks: [
          { p: "Only administrators can sign in. Use the login the installer showed when it finished (see [Getting started](" + t("start") + ")), or ask an administrator to turn on **Administrator** for your account on the [Users & Groups](/users) page." },
          { p: "If the sign-in page says your browser did not keep the sign-in, delete this site's cookies (or use a private window) and sign in again." },
        ],
      },
      {
        id: "notfound",
        title: "The NAS does not appear on the network",
        blocks: [
          {
            list: [
              "Windows: check that **WS-Discovery** is running on the [Services](/services) page, or type **\\\\<NAS IP address>** in File Explorer.",
              "macOS: check that **Bonjour (mDNS)** is running, or use **Go → Connect to Server** with **smb://<NAS IP address>**.",
              "Check that the share has **Visible in network browsing** turned on.",
            ],
          },
        ],
      },
      {
        id: "denied",
        title: "Access denied to a shared folder",
        blocks: [{ p: "Check the share's **Permissions** for your user and its groups. Use your NAS user name and password, not your computer's. On Windows, remove saved credentials in Credential Manager if you changed the password." }],
      },
      {
        id: "onedrive",
        title: "OneDrive does not connect",
        blocks: [{ p: "First check **Settings → EntraID → Test**. Most problems are a redirect URI that does not match the address you use, or the Secret ID pasted instead of the secret Value. See [EntraID](" + t("entra") + ")." }],
      },
      {
        id: "mail",
        title: "Emails do not arrive",
        blocks: [{ p: "Run **Test** in **Settings → SMTP** and fix the step that fails. Then send a test from the [Notifications](/notifications) page and check your spam folder." }],
      },
      {
        id: "uninstall",
        title: "Uninstall Talon",
        blocks: [{ p: "Run `/opt/talon/uninstall.sh` on the NAS. Add `--purge` to also remove the settings. Your data on the volumes is never touched." }],
      },
    ],
  },
];

/** All searchable text of a block, without formatting. */
export function blockText(b: Block): string {
  const raw = "p" in b ? b.p : "steps" in b ? b.steps.join(" ") : "list" in b ? b.list.join(" ") : "tip" in b ? b.tip : "warn" in b ? b.warn : b.alt;
  return plain(raw);
}

export function plain(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
