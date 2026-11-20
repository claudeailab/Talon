import { Check, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { bytes, cx } from "../lib/format";
import type { Disk, Member, StorageStatus, SyncInfo } from "../lib/types";
import { DiskIcon, kindLabel } from "./disk";
import { Badge, IconButton, Progress } from "./ui";

export function StatusBadge({ status }: { status: StorageStatus }) {
  const map: Record<StorageStatus, [string, "green" | "amber" | "red" | "blue" | "violet"]> = {
    healthy: ["Healthy", "green"],
    degraded: ["Degraded", "amber"],
    rebuilding: ["Rebuilding", "blue"],
    building: ["Building", "blue"],
    reshaping: ["Expanding", "blue"],
    syncing: ["Syncing", "blue"],
    checking: ["Scrubbing", "violet"],
    failed: ["Failed", "red"],
    missing: ["Missing", "red"],
    unmounted: ["Not mounted", "amber"],
  };
  const [label, tone] = map[status] ?? [status, "amber"];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export function statusTone(status: StorageStatus): "danger" | "warning" | "info" {
  return status === "failed" || status === "missing" ? "danger" : status === "degraded" || status === "unmounted" ? "warning" : "info";
}

const SYNC_LABEL: Record<string, string> = {
  recover: "Rebuilding",
  resync: "Syncing",
  check: "Scrubbing",
  repair: "Repairing",
  reshape: "Expanding",
};

export function SyncProgress({ sync }: { sync: SyncInfo | null }) {
  if (!sync || sync.sync_action === "idle" || sync.sync_progress == null) return null;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
        <span>{sync.label ?? SYNC_LABEL[sync.sync_action] ?? sync.sync_action}</span>
        <span className="tabular">
          {sync.sync_progress.toFixed(1)}% · {(sync.sync_speed_kbs / 1000).toFixed(0)} MB/s
        </span>
      </div>
      <Progress value={sync.sync_progress} tone="blue" />
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-2 py-2.5 text-center dark:bg-white/[0.03]">
      <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="tabular mt-0.5 text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function memberTone(state: string) {
  return state === "active" ? "green" : state === "spare" || state === "syncing" ? "blue" : state === "rebuilding" ? "violet" : "red";
}

export function MemberList({ members, onRemove }: { members: Member[]; onRemove?: (m: Member) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {members.map((m) => (
        <div key={m.part} className="group flex items-center gap-3 rounded-xl bg-white p-2.5 ring-1 ring-zinc-200/70 dark:bg-zinc-900 dark:ring-white/5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/5">
            <DiskIcon kind={m.kind} className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold">{m.disk}</span>
              <Badge tone={memberTone(m.state)}>{m.state}</Badge>
            </div>
            <div className="truncate text-xs text-zinc-500">
              {m.model} · {bytes(m.size, 0)}
            </div>
          </div>
          {onRemove && (
            <IconButton label={`Remove ${m.disk}`} className="size-8 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onRemove(m)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      ))}
    </div>
  );
}

export function DiskRow({
  d,
  selected,
  onClick,
  disabled,
  radio,
}: {
  d: { name: string; model: string; size: number; kind: string; status: string } & Partial<Pick<Disk, "serial" | "health" | "status_detail">>;
  selected: boolean;
  onClick?: () => void;
  disabled?: boolean;
  radio?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full min-w-0 items-center gap-3 rounded-xl p-2.5 text-left ring-1 transition sm:p-3",
        disabled
          ? "cursor-not-allowed opacity-50 ring-zinc-200 dark:ring-white/5"
          : selected
            ? "bg-brand-50/70 ring-2 ring-brand-500 dark:bg-brand-500/10"
            : "ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 dark:ring-white/10 dark:hover:bg-white/[0.03]",
      )}
    >
      <Tick selected={selected} radio={radio} />
      <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 sm:flex dark:bg-white/5">
        <DiskIcon kind={d.kind} className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-semibold">{d.name}</span>
          <Badge>{kindLabel[d.kind] ?? d.kind}</Badge>
          {d.status === "has_data" && <Badge tone="amber">Has data</Badge>}
          {d.status === "raid_member" && <Badge tone="amber">Foreign RAID</Badge>}
          {d.health === "failing" && <Badge tone="red">SMART failing</Badge>}
        </div>
        <div className="truncate text-xs text-zinc-500">
          {d.model}
          {d.serial && ` · ${d.serial}`}
          {disabled && d.status_detail && ` · ${d.status_detail}`}
        </div>
      </div>
      <div className="tabular shrink-0 text-sm font-semibold">{bytes(d.size)}</div>
    </button>
  );
}

export function Tick({ selected, radio }: { selected: boolean; radio?: boolean }) {
  return (
    <div
      className={cx(
        "flex size-5 shrink-0 items-center justify-center ring-1 transition",
        radio ? "rounded-full" : "rounded-md",
        selected ? "bg-brand-600 text-white ring-brand-600" : "ring-zinc-300 dark:ring-white/20",
      )}
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </div>
  );
}

export function Dots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-1.5 w-3 rounded-full", i <= n ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />
      ))}
    </span>
  );
}

export function Stepper({ steps, step }: { steps: string[]; step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className={cx("flex min-w-0 items-center gap-2", i < steps.length - 1 && "flex-1")}>
          <div
            className={cx(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
              i < step && "bg-brand-600 text-white",
              i === step && "bg-brand-600 text-white ring-4 ring-brand-500/20",
              i > step && "bg-zinc-100 text-zinc-500 dark:bg-white/5",
            )}
          >
            {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
          </div>
          <span className={cx("hidden truncate text-[13px] font-medium sm:inline", i === step ? "text-zinc-900 dark:text-white" : "text-zinc-500")}>{s}</span>
          {i < steps.length - 1 && <div className={cx("h-px min-w-3 flex-1", i < step ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />}
        </li>
      ))}
    </ol>
  );
}

export const NAME_RE = /^[a-z][a-z0-9_-]{0,23}$/;
export const NAME_HINT = "Use lowercase letters, digits, - and _ (start with a letter, max 24)";
