/* The user guide shown on the Support page.
 *
 * Text supports **bold** (names of buttons, fields and pages) and [links](/path)
 * to pages in Talon or to other topics (/support?topic=<id>). Screenshots live in
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

const t = (x: string) => `/support?topic=${x}`;

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
              "Add an account for each person on the [Users & groups](/users) page. See [Users and groups](" + t("users") + ").",
              "Create shared folders and choose who may use them on the [Shared folders](/shares) page. See [Shared folders](" + t("shares") + ").",
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
          { p: "Open **https://<NAS address>/** in a browser, for example https://192.168.1.50/ or https://<hostname>.local/." },
          { p: "Sign in with the Linux account you installed Talon with. Other users can sign in once they are marked as **Administrator** on the [Users & groups](/users) page." },
          { p: "The first time, the browser warns that the connection is not private. This is expected: Talon uses its own certificate. Choose **Advanced** and continue to the site." },
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
              "**CPU, Memory, Network and Disk activity**: live values and the last few minutes as a chart.",
              "**Storage**: each volume with its free space, each RAID array with its health and disks, your shared folders and, when turned on, OneDrive.",
              "**System**: model, operating system, uptime and network addresses.",
              "**Disks**: every disk with its health and temperature.",
              "**Services**: which network services are running.",
            ],
          },
          { p: "The badge at the top right says **All systems healthy**, or how many issues need attention. Each issue appears as a card above the charts; click it to go to the page where you can fix it." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Storage
  {
    id: "raid",
    title: "RAID",
    group: "Storage",
    summary: "Combine disks into one array that survives disk failures.",
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
              "**Add disk**: add a disk as a **Hot spare** (stands by and automatically replaces a failing disk), to **Expand capacity**, or to **Add mirror** for RAID 1.",
              "**Replace failed disk**: rebuild the missing data onto a new disk.",
              "**Remove disk**: take a disk out of the array.",
              "**Run data scrub**: read every block to find and repair hidden errors. Running one every month or two is good practice. **Stop data scrub** stops it.",
              "**Delete RAID**: only possible after its volume is deleted.",
            ],
          },
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
              "**Browse files** opens the volume on the [Files](/files) page.",
              "**Expand filesystem** appears after the RAID array under the volume has grown.",
              "**Delete volume** erases everything on it.",
            ],
          },
          { p: "Next step: share folders on the volume. See [Shared folders](" + t("shares") + ")." },
        ],
      },
    ],
  },
  {
    id: "files",
    title: "Files",
    group: "Storage",
    summary: "Browse, upload and download files in the browser.",
    page: { to: "/files", label: "Open Files" },
    sections: [
      {
        id: "browse",
        title: "Browse",
        blocks: [
          { img: "files", alt: "Files page" },
          {
            list: [
              "Pick a **Volume** at the top. Click once to select an item, double-click a folder to open it.",
              "Use the path at the top to go back up, and **Filter this folder** to find a name.",
              "Hidden items whose names start with a dot, like .recycle and .versions, are not shown.",
            ],
          },
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
          { warn: "Delete on this page is permanent. Folders are deleted with everything inside them." },
        ],
      },
    ],
  },
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
          { p: "Every disk shows its type (HDD, SSD, NVMe, USB), size, what it is used for, health and temperature. Click a disk for its S.M.A.R.T. details: power-on time, bad sectors, wear and every attribute." },
          { p: "Virtual disks and some USB enclosures do not report health; they show what they are used for instead." },
        ],
      },
      {
        id: "tests",
        title: "Self-tests",
        blocks: [
          { p: "Open a disk and start a **Short** (a few minutes) or **Extended** (several hours) self-test. The result appears in its **Self-test log**." },
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

  // ------------------------------------------------------------ Sharing
  {
    id: "shares",
    title: "Shared folders",
    group: "Sharing",
    summary: "Make folders available on your network and choose who may use them.",
    page: { to: "/shares", label: "Open Shared folders" },
    before: ["A volume. See [Volumes](" + t("volumes") + ")."],
    sections: [
      {
        id: "create",
        title: "Create a shared folder",
        blocks: [
          {
            steps: [
              "On the [Shared folders](/shares) page, click **New share**.",
              "**General**: enter the **Name** that people see on the network, pick the **Volume** and optionally a **Description**. A folder with this name is created on the volume.",
              "**Permissions**: give each user or group **No access**, **Read** or **Read/Write**. **Guests** means anyone on the network, without a password.",
              "**SMB**: for Windows, macOS, Linux, Android and iOS. On by default. Options below.",
              "**NFS**: for Linux, Kodi, VMware ESXi and Proxmox. Options below.",
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
              "**Recycle bin**: deleted files are moved to a hidden .recycle folder instead of being removed.",
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
              "**Allowed clients**: add each computer's address or network (for example 192.168.1.0/24) with **Read** or **Read/Write**.",
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
    before: ["A shared folder and a user with access to it. See [Shared folders](" + t("shares") + ")."],
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
          { p: "NFS: add the computer under **Allowed clients** of the share, then run: **sudo mount -t nfs <NAS IP address>:/srv/nas/<volume>/<share> /mnt/<share>**" },
        ],
      },
    ],
  },
  {
    id: "users",
    title: "Users and groups",
    group: "Sharing",
    summary: "Accounts for shared folders and for this web interface.",
    page: { to: "/users", label: "Open Users & groups" },
    sections: [
      {
        id: "users",
        title: "Add a user",
        blocks: [
          {
            steps: [
              "On the [Users & groups](/users) page, click **Add user**.",
              "Enter a **User name**, optionally a **Full name**, and a **Password** twice. This password is also used to open shared folders.",
              "Turn on **Administrator** only for people who should manage the NAS in this web interface.",
              "Click **Create user**, then give the user access on the [Shared folders](/shares) page.",
            ],
          },
          { img: "users", alt: "Users and groups" },
          { p: "In a user's **⋯** menu you can **Edit** them, **Change password**, **Disable** or **Enable** them and **Delete** them. Files a deleted user created stay on the volumes." },
        ],
      },
      {
        id: "groups",
        title: "Groups",
        blocks: [
          { p: "Groups give several users the same access, for example a group family with Read/Write to Photos. Click **Add group**, enter a **Group name**, select its members and click **Create group**. Then give the group access on the [Shared folders](/shares) page." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Cloud and alerts
  {
    id: "onedrive",
    title: "OneDrive",
    group: "Cloud and alerts",
    summary: "Back up or sync folders between this NAS and Microsoft OneDrive.",
    page: { to: "/onedrive", label: "Open OneDrive" },
    before: [
      "A Microsoft Entra ID app, set up once in **Settings → Entra ID**. See [Entra ID](" + t("entra") + "). OneDrive cannot sign in without it.",
      "The **OneDrive** service turned on in [Services](/services).",
    ],
    sections: [
      {
        id: "setup",
        title: "Set up OneDrive",
        blocks: [
          {
            steps: [
              "Set up the Entra ID app and click **Test** until it passes. See [Entra ID](" + t("entra") + ").",
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
          {
            list: [
              "**Backup from OneDrive**: copies OneDrive files to the NAS.",
              "**Backup to OneDrive**: copies NAS files to OneDrive.",
              "**Two-way sync** (beta): changes go both ways. Folders only. A file changed on both sides is kept twice, one copy renamed.",
            ],
          },
          {
            steps: [
              "Choose the **Direction**.",
              "Click **Browse** to pick the OneDrive folder or file and the NAS folder. Click once to select, double-click to open a folder, or use **New folder**.",
              "Enter a **Task name** and pick a **Schedule**: **Manually**, every 15 minutes up to every 12 hours, or **Daily** at a set time.",
              "Optional: a **Speed limit**, so backups do not slow down your internet.",
              "Click **Create task**.",
            ],
          },
          {
            list: [
              "**Delete files removed from OneDrive / the NAS**: off means nothing is ever deleted (safer).",
              "**Keep old versions**: replaced or deleted files are kept in a hidden .versions folder for 30 days.",
            ],
          },
        ],
      },
      {
        id: "run",
        title: "Run and check tasks",
        blocks: [
          { p: "Each task shows its schedule, last run and status. Use **Run now** to start it, **Stop** to cancel it, and the **⋯** menu to edit it, view its log or delete it. Deleting a task does not touch any files." },
          { p: "**Disconnect** signs out of Microsoft. Tasks stop running until you sign in again; no files are deleted." },
          { tip: "With [Email notifications](" + t("email") + ") you get an email when a OneDrive task fails." },
        ],
      },
    ],
  },
  {
    id: "entra",
    title: "Entra ID (Microsoft sign-in)",
    group: "Cloud and alerts",
    summary: "The one-time Microsoft app registration that OneDrive needs to sign in.",
    page: { to: "/settings?tab=entra", label: "Open Settings → Entra ID" },
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
          { p: "Talon shows the same steps under **Settings → Entra ID → Setup guide**, with your exact redirect address and a **Copy** button." },
          {
            steps: [
              "Go to **entra.microsoft.com** and sign in with an account that can register apps.",
              "**App registrations → New registration**, name it **Talon NAS**. For account types, pick the option that includes **personal Microsoft accounts**. Redirect URI: platform **Web**, paste the address from Talon's **Redirect URI** field, then click **Register**.",
              "Copy the **Application (client) ID** from the app's **Overview** page into Talon.",
              "**Certificates & secrets → New client secret**, expiry **24 months**. Copy the secret **Value** (not the Secret ID) into Talon. It is shown only once.",
              "**API permissions → Add a permission → Microsoft Graph → Delegated**. Add **Files.ReadWrite** and **offline_access**. Work accounts: click **Grant admin consent**.",
              "In Talon, choose the **Supported account types** you picked in step 2, click **Save**, then **Test**.",
            ],
          },
          { img: "entra-guide", alt: "Entra ID setup guide" },
          { p: "**Directory (tenant) ID** is only needed for **Only my organization**. Leave it empty for personal accounts." },
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
              "**Account types**: the choice in Talon must match the app registration.",
            ],
          },
          { warn: "Client secrets expire (after 24 months with the recommended setting). Create a new one in Entra before then and save it in Talon, or OneDrive tasks stop." },
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
              "Open the [Notifications](/notifications) page.",
              "Enter one or more addresses under **Send to**, separated by commas.",
              "Under **Send an e-mail when**, choose the events: RAID degraded or failed, disk health warning, disk too hot, volume almost full, background task failed, OneDrive task failed, software update available, and failed sign-in attempt.",
              "Click **Save**, then **Send test** to send a test email.",
            ],
          },
          { img: "notifications", alt: "Notifications" },
          { p: "Each alert is sent once, and again only if it clears and comes back." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ System
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
            ],
          },
          { p: "Turn a service on or off with its switch; it then also starts, or no longer starts, at boot. **Restart** restarts a running service." },
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings and updates",
    group: "System",
    summary: "Name, time zone, Windows and macOS options, and software updates.",
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
              "**Workgroup**: the Windows workgroup. WORKGROUP is the Windows default.",
              "**Minimum SMB protocol**: SMB2_10 or newer is recommended. Lower it only for very old devices.",
              "**macOS compatibility**: faster Finder browsing and correct metadata for Macs.",
            ],
          },
        ],
      },
      {
        id: "update",
        title: "Software updates",
        blocks: [
          { img: "settings-update", alt: "Software update" },
          { p: "Talon checks for a new version every 6 hours. When one is available, a button at the bottom of the menu says so. Open [Settings → Update](/settings?tab=update) and click **Install now**." },
          { p: "An update takes about 1–3 minutes. The web interface restarts and reloads by itself. Shared folders stay available and volumes are not touched. If anything fails, the previous version is restored automatically." },
        ],
      },
      {
        id: "other",
        title: "Entra ID, SMTP and About",
        blocks: [
          { p: "**Entra ID** is the Microsoft sign-in for OneDrive ([Entra ID](" + t("entra") + ")). **SMTP** sends emails ([Email notifications](" + t("email") + ")). **About** shows the Talon version and the hardware." },
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Activity",
    group: "System",
    summary: "A log of administrative actions and background tasks.",
    page: { to: "/activity", label: "Open Activity" },
    sections: [
      {
        id: "log",
        title: "Activity log and tasks",
        blocks: [
          { img: "activity", alt: "Activity" },
          { p: "**Tasks** lists background jobs, such as creating a RAID array or installing an update, with their progress and result. The **Activity log** lists who changed what and when. Choose how many entries to show per page and use **Previous** and **Next**." },
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
        blocks: [{ p: "Only administrators can sign in. Use the Linux account you installed Talon with, or ask an administrator to turn on **Administrator** for your account on the [Users & groups](/users) page." }],
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
        blocks: [{ p: "First check **Settings → Entra ID → Test**. Most problems are a redirect URI that does not match the address you use, or the Secret ID pasted instead of the secret Value. See [Entra ID](" + t("entra") + ")." }],
      },
      {
        id: "mail",
        title: "Emails do not arrive",
        blocks: [{ p: "Run **Test** in **Settings → SMTP** and fix the step that fails. Then send a test from the [Notifications](/notifications) page and check your spam folder." }],
      },
      {
        id: "uninstall",
        title: "Uninstall Talon",
        blocks: [{ p: "Run **/opt/talon/uninstall.sh** on the NAS. Add **--purge** to also remove the settings. Your data on the volumes is never touched." }],
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
  return s.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
