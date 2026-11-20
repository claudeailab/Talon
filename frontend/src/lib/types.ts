export interface Disk {
  name: string;
  path: string;
  model: string;
  vendor: string;
  serial: string;
  size: number;
  kind: "hdd" | "ssd" | "nvme" | "usb" | "sd" | "virtual";
  transport: string | null;
  rotational: boolean;
  removable: boolean;
  partitions: { name: string; size: number; fstype: string | null; label: string | null; mountpoints: string[] }[];
  mounts: string[];
  status: "available" | "has_data" | "volume" | "raid" | "raid_member" | "system" | "mounted";
  status_detail: string;
  volume: string | null;
  array: string | null;
  selectable: boolean;
  health: "good" | "warning" | "failing" | "unknown";
  temperature: number | null;
  power_on_hours: number | null;
}

export interface Member {
  part: string;
  disk: string;
  state: "active" | "spare" | "faulty" | "rebuilding";
  slot?: string;
  model: string;
  size: number;
  kind: string;
}

export type StorageStatus =
  | "healthy"
  | "degraded"
  | "rebuilding"
  | "reshaping"
  | "syncing"
  | "checking"
  | "failed"
  | "missing"
  | "unmounted";

export interface SyncInfo {
  sync_action: string;
  sync_progress: number | null;
  sync_speed_kbs: number;
}

export interface RaidArray {
  name: string;
  level: string;
  created: number | null;
  volume: string | null;
  size: number;
  members: Member[];
  sync: SyncInfo | null;
  raid_disks?: number;
  degraded?: number;
  status: StorageStatus;
  status_detail: string;
  fault_tolerance: number;
}

export interface Volume {
  name: string;
  level: string;
  fs: string;
  mountpoint: string;
  created: number | null;
  mounted: boolean;
  size: number;
  used: number;
  free: number;
  array: string | null;
  disk: string | null;
  members: Member[];
  sync: SyncInfo | null;
  shares: string[];
  can_expand_fs: boolean;
  status: StorageStatus;
  status_detail: string;
  fault_tolerance: number;
}

export interface VolumeSources {
  arrays: { name: string; level: string; size: number; status: StorageStatus }[];
  disks: { name: string; model: string; size: number; kind: string; status: string }[];
}

export interface RaidOption {
  id: string;
  label: string;
  min_disks: number;
  supports_spares: boolean;
  description: string;
  read_perf: number;
  write_perf: number;
  available: boolean;
  reason: string | null;
  usable_bytes: number;
  raw_bytes: number;
  fault_tolerance: number;
  recommended: boolean;
  warnings: string[];
}

export type Access = "ro" | "rw";

export interface Share {
  name: string;
  volume: string;
  folder: string;
  description: string;
  guest: "none" | "ro";
  users: Record<string, Access>;
  groups: Record<string, Access>;
  smb: { enabled: boolean; browseable: boolean; recycle_bin: boolean; time_machine: boolean };
  nfs: { enabled: boolean; clients: { host: string; access: Access }[]; squash: "all" | "root" | "none"; insecure: boolean };
  path: string | null;
  created?: number;
}

export interface User {
  name: string;
  uid: number;
  full_name: string;
  admin: boolean;
  disabled: boolean;
  smb: boolean;
  groups: string[];
}

export interface Group {
  name: string;
  members: string[];
}

export interface Job {
  id: string;
  title: string;
  user: string;
  status: "queued" | "running" | "success" | "error";
  error: string | null;
  started: number;
  finished: number | null;
  log?: string[];
}

export interface Service {
  id: string;
  unit: string | null;
  installed: boolean;
  active: boolean;
  enabled: boolean;
  label: string;
  description: string;
}

export interface SysInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  model: string;
  cpu: string;
  cores: number;
  memory: number;
  boot_time: number;
  addresses: { iface: string; address: string; family: number; up: boolean; speed: number }[];
  version?: string;
}

export interface Point {
  ts: number;
  cpu: number;
  mem_used: number;
  mem_total: number;
  temp: number | null;
  load: number[];
  rx: number;
  tx: number;
  read: number;
  write: number;
}

export interface Alert {
  level: "critical" | "warning";
  title: string;
  detail: string;
  link: string;
}

export interface Dashboard {
  info: SysInfo;
  history: Point[];
  volumes: Volume[];
  disks: Pick<Disk, "name" | "model" | "size" | "kind" | "status" | "health" | "temperature" | "volume" | "array">[];
  services: Service[];
  alerts: Alert[];
  shares: number;
  users: number;
  jobs: Job[];
}

export interface Settings {
  workgroup: string;
  server_string: string;
  smb_min_protocol: string;
  smb_macos_compat: boolean;
  hostname: string;
  timezone: string;
  smb_protocols: string[];
}

export interface Activity {
  ts: number;
  user: string;
  message: string;
  level: "info" | "warning" | "error";
}

export interface UpdateStatus {
  state: "idle" | "running" | "success" | "failed";
  step?: "starting" | "download" | "backup" | "install" | "restart" | "rollback" | "done";
  from?: string;
  target?: string;
  user?: string;
  started?: number;
  finished?: number;
  error?: string;
  log?: string[];
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  name: string | null;
  notes: string | null;
  url: string | null;
  published_at: string | null;
  checked_at: number | null;
  error: string | null;
  repo: string;
  status: UpdateStatus;
}
