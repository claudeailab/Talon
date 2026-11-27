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

/* ---------------------------------------------------------------- item cards
   RAID arrays, volumes and backups share one compact layout, so their columns line
   up from card to card: who it is | the main bar | a fixed column of facts or buttons,
   with the ⋯ menu in the corner and a slim footer (member disks, folders, dates). */

/** The card's one row: a fixed-width name column, so the middle (the bar and the details
 *  under it) takes all the room left; on phones the three parts stack. */
export const ITEM_ROW =
  "grid gap-x-8 gap-y-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_15rem] md:items-center md:pr-16 md:[&>*:first-child]:col-span-2 xl:col-span-full xl:grid-cols-subgrid xl:[&>*:first-child]:col-span-1";
/* On wide screens the cards share their columns (CSS subgrid): the name column is as wide
   as the longest name on the page (up to a limit; a name itself never wraps), so short
   names waste no room and the bars still line up from card to card. The last column has
   room for the ⋯ menu (the row's right padding). */
/** The list of cards. */
export const ITEM_LIST =
  "grid gap-4 xl:grid-cols-[fit-content(20rem)_minmax(0,1fr)_19rem] 2xl:grid-cols-[fit-content(30rem)_minmax(0,1fr)_19rem]";
/** A card in the list; everything in it spans the shared columns. */
export const ITEM_CARD = "relative overflow-hidden xl:col-span-full xl:grid xl:grid-cols-subgrid xl:[&>*]:col-span-full";
/** The box around the row and its ⋯ menu. */
export const ITEM_WRAP = "relative xl:grid xl:grid-cols-subgrid";

/** Icon, name with its status and one line of details. */
export function ItemTitle({ icon, name, badge, children, note, tone = "brand" }: { icon: ReactNode; name: ReactNode; badge?: ReactNode; children?: ReactNode; note?: ReactNode; tone?: "brand" | "amber" }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 pr-9 md:pr-0 xl:min-w-auto">
      <div
        className={cx(
          "flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5",
          tone === "brand"
            ? "bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-md shadow-brand-500/20"
            : "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 xl:min-w-auto">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[15px] font-semibold tracking-tight break-words xl:whitespace-nowrap">{name}</h3>
          {badge}
        </div>
        {children && <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-zinc-500">{children}</div>}
        {note && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{note}</div>}
      </div>
    </div>
  );
}

/** A small fact: label above value, left-aligned so the values line up between cards. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="tabular mt-0.5 text-[13.5px] font-semibold whitespace-nowrap">{value}</div>
    </div>
  );
}

/** The details under an item's bar: labelled groups side by side. */
export function Details({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">{children}</div>;
}

/** One labelled group in Details. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
      {children}
    </div>
  );
}

const MEMBER_DOT: Record<string, string> = { active: "bg-emerald-500", spare: "bg-sky-500", rebuilding: "bg-violet-500", syncing: "bg-sky-500" };

/** Member disks as chips: name, size and, unless it is simply active, its state. */
export function MemberChips({ members, onRemove }: { members: Member[]; onRemove?: (m: Member) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m, i) => {
        const busy = m.state === "syncing" || m.state === "rebuilding";
        // each disk's sweep starts a little later than the one before: data flowing across the array
        const delay = { animationDelay: `${i * 0.35}s` };
        return (
        <span
          key={m.part}
          title={`${m.model} · ${bytes(m.size, 0)} · ${m.state}`}
          className={cx(
            "group relative inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-lg bg-white pr-2 pl-2 text-zinc-700 ring-1 ring-inset dark:bg-white/[0.04] dark:text-zinc-300",
            busy ? "ring-sky-300 dark:ring-sky-400/40" : "ring-zinc-200 dark:ring-white/10",
          )}
        >
          {busy && (
            <span
              aria-hidden
              style={delay}
              className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-sky-400/20 to-transparent motion-safe:animate-[sweep_1.8s_ease-in-out_infinite] motion-reduce:hidden dark:via-sky-400/15"
            />
          )}
          <DiskIcon kind={m.kind} className={cx("size-3.5", busy ? "text-sky-500" : "text-zinc-400")} />
          <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">{m.disk}</span>
          <span className="tabular text-xs text-zinc-500">{bytes(m.size, 0)}</span>
          {busy ? (
            <span className="relative flex size-1.5">
              <span style={delay} className={cx("absolute inset-0 rounded-full opacity-75 motion-safe:animate-ping", MEMBER_DOT[m.state])} />
              <span style={delay} className={cx("relative size-1.5 rounded-full motion-safe:animate-[blink_0.9s_steps(2,jump-none)_infinite]", MEMBER_DOT[m.state])} />
            </span>
          ) : (
            <span className={cx("size-1.5 rounded-full", MEMBER_DOT[m.state] ?? "bg-rose-500")} />
          )}
          {m.state !== "active" && <span className={cx("text-xs font-medium", m.state === "faulty" ? "text-rose-600 dark:text-rose-400" : "text-zinc-600 dark:text-zinc-300")}>{m.state}</span>}
          {onRemove && (
            <IconButton
              label={`Remove ${m.disk}`}
              className="-mr-1 size-6 sm:hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex"
              onClick={() => onRemove(m)}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
        </span>
        );
      })}
    </div>
  );
}

/** The ⋯ menu's place in an item card's corner. */
export const ITEM_MENU = "absolute top-3 right-3 sm:top-4 sm:right-4 xl:top-1/2 xl:-translate-y-1/2";

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
        <div className="[overflow-wrap:anywhere] text-xs text-zinc-500">
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
          <span className={cx("hidden [overflow-wrap:anywhere] text-[13px] font-medium sm:inline", i === step ? "text-zinc-900 dark:text-white" : "text-zinc-500")}>{s}</span>
          {i < steps.length - 1 && <div className={cx("h-px min-w-3 flex-1", i < step ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />}
        </li>
      ))}
    </ol>
  );
}

export const NAME_RE = /^[a-z][a-z0-9_-]{0,23}$/;
export const NAME_HINT = "Use lowercase letters, digits, - and _ (start with a letter, max 24)";
