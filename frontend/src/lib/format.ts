// Storage vendors label capacity in decimal units (1 TB = 10^12 bytes); we do the same
// so a "4 TB" disk shows as 4 TB.
export function bytes(n: number | null | undefined, digits = 1): string {
  if (n == null || isNaN(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  const d = i === 0 ? 0 : v >= 100 ? 0 : digits;
  return `${v.toFixed(d)} ${u[i]}`;
}

export function rate(n: number | null | undefined): string {
  if (n == null) return "—";
  return bytes(n) + "/s";
}

export function pct(a: number, b: number): number {
  return b > 0 ? Math.min(100, Math.max(0, (a / b) * 100)) : 0;
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ago(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export const levelLabel: Record<string, string> = {
  single: "Single",
  raid0: "RAID 0",
  raid1: "RAID 1",
  raid5: "RAID 5",
  raid6: "RAID 6",
  raid10: "RAID 10",
};

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Stable JSON (object keys sorted) for comparing form values. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/** True when two form values are equal (ignores object key order). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** True when two lists hold the same items, in any order. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && sameValue([...a].sort(), [...b].sort());
}
