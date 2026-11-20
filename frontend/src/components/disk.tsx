import { Cpu, HardDrive, MemoryStick, Usb } from "lucide-react";
import type { Disk } from "../lib/types";
import { Badge } from "./ui";

export function DiskIcon({ kind, className = "size-5" }: { kind: string; className?: string }) {
  if (kind === "nvme") return <Cpu className={className} />;
  if (kind === "usb") return <Usb className={className} />;
  if (kind === "sd") return <MemoryStick className={className} />;
  return <HardDrive className={className} />;
}

export const kindLabel: Record<string, string> = {
  hdd: "HDD",
  ssd: "SSD",
  nvme: "NVMe",
  usb: "USB",
  sd: "SD card",
};

export function HealthBadge({ health }: { health: Disk["health"] }) {
  if (health === "good") return <Badge tone="green" dot>Healthy</Badge>;
  if (health === "warning") return <Badge tone="amber" dot>Warning</Badge>;
  if (health === "failing") return <Badge tone="red" dot>Failing</Badge>;
  return <Badge dot>Unknown</Badge>;
}

export function DiskStatusBadge({ d }: { d: Pick<Disk, "status" | "volume" | "array"> }) {
  switch (d.status) {
    case "available":
      return <Badge tone="blue">Available</Badge>;
    case "has_data":
      return <Badge tone="amber">Has data</Badge>;
    case "volume":
      return <Badge tone="violet">{d.volume}</Badge>;
    case "raid":
      return <Badge tone="violet">RAID {d.array}</Badge>;
    case "system":
      return <Badge>System</Badge>;
    case "raid_member":
      return <Badge tone="amber">Foreign RAID</Badge>;
    default:
      return <Badge>Mounted</Badge>;
  }
}
