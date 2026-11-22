import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CalendarClock, MoreHorizontal, Play, RotateCcw, ShieldAlert, ShieldCheck, Square, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime, duration } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Job, Share } from "../lib/types";
import { JobDialog } from "../components/jobs";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  Empty,
  IconButton,
  Input,
  Menu,
  MenuItem,
  PageHeader,
  PageLoader,
  Progress,
  Segmented,
  Select,
} from "../components/ui";

type QItem = { id: string; path: string; virus: string; found: number; size: number };
type AvInfo = {
  installed: boolean;
  version: string | null;
  db_date: number | null;
  definitions: boolean;
  ram: number;
  ram_ok: boolean;
  ram_warning: boolean;
  progress: { state: "idle" | "running" | "success" | "error" | "stopped"; phase?: string; done?: number; total?: number; found?: number; file?: string; error?: string; shares?: string[] };
  settings: { shares: string[]; schedule: "off" | "daily" | "weekly"; time: string; weekday: number };
  last_scan: { at: number; duration: number; files: number; found: number; shares: string[]; stopped: boolean; error: string | null } | null;
  quarantine: QItem[];
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function AntivirusPage() {
  const q = useQuery({
    queryKey: ["antivirus"],
    queryFn: () => api.get<AvInfo>("/antivirus"),
    refetchInterval: (query) => (query.state.data?.progress.state === "running" ? 1000 : 15000),
  });
  const shares = useQuery({ queryKey: ["shares"], queryFn: () => api.get<Share[]>("/shares") });
  const [job, setJob] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const install = useAction(() => api.post<Job>("/antivirus/install"), { invalidate: ["antivirus"], onSuccess: (j) => setJob(j.id) });
  const uninstall = useAction(() => api.post<Job>("/antivirus/remove"), {
    invalidate: ["antivirus"],
    onSuccess: (j) => {
      setRemove(false);
      setJob(j.id);
    },
  });
  if (!q.data || !shares.data) return <PageLoader />;
  const d = q.data;
  return (
    <>
      <PageHeader title="Antivirus" description="Scan shared folders for viruses" />
      <div className="space-y-5">
        <Card>
          <CardHeader
            icon={<ShieldCheck className="size-4.5" />}
            title="ClamAV"
            subtitle="Free, open-source antivirus by Cisco Talos"
            actions={
              d.installed && (
                <Menu
                  trigger={
                    <IconButton label="Antivirus actions">
                      <MoreHorizontal className="size-5" />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Trash2 />} danger onClick={() => setRemove(true)}>
                    Remove ClamAV
                  </MenuItem>
                </Menu>
              )
            }
          />
          <div className="space-y-3 px-5 pb-5">
            {!d.installed ? (
              <>
                <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
                  Scans your shared folders on demand or on a schedule. Infected files move to a quarantine, where you can restore or delete them, and you get an
                  email. A scan uses about 1.5 GB of memory while it runs; nothing stays in memory afterwards.
                </p>
                {!d.ram_ok ? (
                  <Callout tone="warning" title="Not enough memory">This NAS has {bytes(d.ram)} of memory. ClamAV needs at least 2 GB.</Callout>
                ) : (
                  d.ram_warning && (
                    <Callout tone="warning">
                      This NAS has {bytes(d.ram)} of memory. ClamAV recommends 3 GB or more: scans work, but other services may slow down while one runs.
                    </Callout>
                  )
                )}
                <Button variant="primary" disabled={!d.ram_ok} loading={install.isPending} onClick={() => install.mutate()}>
                  Install ClamAV
                </Button>
                <p className="text-xs text-zinc-500">Downloads about 300 MB, including the virus definitions.</p>
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <Fact label="Version" value={d.version ?? "—"} />
                <Fact
                  label="Virus definitions"
                  value={d.db_date ? `Updated ${ago(d.db_date)}` : d.definitions ? "Installed" : "Downloading…"}
                  hint="Updated automatically several times a day"
                />
                <Fact label="Last scan" value={d.last_scan ? ago(d.last_scan.at) : "Never"} />
              </div>
            )}
          </div>
        </Card>

        {d.installed && <ScanCard d={d} shares={shares.data} />}
        {d.installed && <ScheduleCard d={d} shares={shares.data} />}
        {(d.installed || d.quarantine.length > 0) && <QuarantineCard items={d.quarantine} />}
      </div>
      <JobDialog jobId={job} onClose={() => setJob(null)} />
      <ConfirmDialog
        open={remove}
        onClose={() => setRemove(false)}
        onConfirm={() => uninstall.mutate()}
        loading={uninstall.isPending}
        danger
        title="Remove ClamAV?"
        confirmText="Remove"
        message="Scheduled scans stop. Files in the quarantine stay there until you restore or delete them."
      />
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-50 px-3.5 py-2.5 dark:bg-white/[0.04]">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-[13.5px] font-semibold break-words">{value}</div>
      {hint && <div className="text-[11.5px] text-zinc-500">{hint}</div>}
    </div>
  );
}

/** Which shared folders: all of them (none chosen), or the ones ticked. */
function SharePicker({ shares, value, onChange }: { shares: Share[]; value: string[]; onChange: (v: string[]) => void }) {
  const all = value.length === 0;
  const chip = (on: boolean) =>
    cx(
      "rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset transition",
      on ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30" : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5",
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={chip(all)} onClick={() => onChange([])}>
        All shared folders
      </button>
      {shares.map((s) => {
        const on = value.includes(s.name);
        return (
          <button key={s.name} type="button" className={chip(on)} onClick={() => onChange(on ? value.filter((x) => x !== s.name) : [...value, s.name])}>
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

function ScanCard({ d, shares }: { d: AvInfo; shares: Share[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const scan = useAction(() => api.post<AvInfo>("/antivirus/scan", { shares: sel }), { invalidate: ["antivirus"] });
  const stop = useAction(() => api.post("/antivirus/stop"), { invalidate: ["antivirus"] });
  const p = d.progress;
  const running = p.state === "running";
  const last = d.last_scan;
  const pctDone = p.total ? Math.min(100, ((p.done ?? 0) / p.total) * 100) : 0;
  return (
    <Card>
      <CardHeader icon={<Play className="size-4.5" />} title="Scan Now" subtitle="Choose the shared folders to scan" />
      <div className="space-y-4 px-5 pb-5">
        {running ? (
          <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-white/[0.03]">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {p.phase === "counting" ? "Counting files…" : p.phase === "loading" ? "Loading the virus definitions…" : `Scanning ${p.shares?.join(", ")}`}
                </div>
                <div className="text-[13px] text-zinc-500">
                  {(p.done ?? 0).toLocaleString()} of {(p.total ?? 0).toLocaleString()} files
                  {p.found ? <span className="font-medium text-rose-600 dark:text-rose-400"> · {p.found} infected</span> : " · nothing found so far"}
                </div>
              </div>
              <Button size="sm" icon={<Square className="size-3.5" />} loading={stop.isPending} onClick={() => stop.mutate()}>
                Stop
              </Button>
            </div>
            <Progress value={pctDone} className="mt-3 h-2" />
            {p.file && <div className="mt-2 font-mono text-[11.5px] break-all text-zinc-500">{p.file}</div>}
          </div>
        ) : (
          <>
            <SharePicker shares={shares} value={sel} onChange={setSel} />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<Play className="size-4" />} loading={scan.isPending} disabled={!d.definitions && !d.db_date} onClick={() => scan.mutate()}>
                Scan now
              </Button>
              {!d.definitions && !d.db_date && <span className="text-xs text-zinc-500">Waiting for the virus definitions to download</span>}
            </div>
          </>
        )}
        {!running && last && (
          <div className={cx("flex items-start gap-3 rounded-xl p-3.5", last.found ? "bg-rose-50 dark:bg-rose-500/10" : last.error ? "bg-amber-50 dark:bg-amber-500/10" : "bg-emerald-50/70 dark:bg-emerald-500/10")}>
            {last.found ? <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-600" /> : <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />}
            <div className="min-w-0 text-[13px]">
              <div className="font-semibold">
                {last.found ? `${last.found} infected file${last.found > 1 ? "s" : ""} moved to the quarantine` : last.error ? "The scan failed" : last.stopped ? "Scan stopped" : "No viruses found"}
              </div>
              <div className="break-words text-zinc-600 dark:text-zinc-400">
                {last.error ?? `${last.files.toLocaleString()} files in ${last.shares.join(", ")} · ${dateTime(last.at)} · took ${last.duration < 60 ? "under a minute" : duration(last.duration)}`}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ScheduleCard({ d, shares }: { d: AvInfo; shares: Share[] }) {
  const [s, setS] = useState(d.settings);
  useEffect(() => setS(d.settings), [d.settings.schedule, d.settings.time, d.settings.weekday, d.settings.shares.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => api.put<AvInfo>("/antivirus/settings", s), { invalidate: ["antivirus"], success: "Schedule saved" });
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time);
  const changed = JSON.stringify(s) !== JSON.stringify(d.settings);
  return (
    <Card>
      <CardHeader
        icon={<CalendarClock className="size-4.5" />}
        title="Scheduled Scan"
        subtitle={d.settings.schedule === "off" ? "Off" : `${d.settings.schedule === "daily" ? "Every day" : `Every ${DAYS[d.settings.weekday]}`} at ${d.settings.time}`}
        actions={
          <Button variant="primary" disabled={!changed || !timeOk} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <Segmented
          value={s.schedule}
          onChange={(v) => setS({ ...s, schedule: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ]}
        />
        {s.schedule !== "off" && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {s.schedule === "weekly" && (
                <Select value={s.weekday} onChange={(e) => setS({ ...s, weekday: Number(e.target.value) })} className="w-40" aria-label="Day">
                  {DAYS.map((day, i) => (
                    <option key={day} value={i}>{day}</option>
                  ))}
                </Select>
              )}
              <span className="text-[13px] text-zinc-500">at</span>
              <Input value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} className="w-24" aria-label="Time" placeholder="02:30" />
              {!timeOk && <span className="text-xs text-rose-600">Use hh:mm, 24-hour</span>}
            </div>
            <SharePicker shares={shares} value={s.shares} onChange={(v) => setS({ ...s, shares: v })} />
          </>
        )}
      </div>
    </Card>
  );
}

function QuarantineCard({ items }: { items: QItem[] }) {
  const restore = useAction((id: string) => api.post(`/antivirus/quarantine/${id}/restore`), { invalidate: ["antivirus"], success: "Restored to its folder" });
  const del = useAction((id: string) => api.del(`/antivirus/quarantine/${id}`), { invalidate: ["antivirus"], success: "Deleted", onSuccess: () => setConfirm(null) });
  const [confirm, setConfirm] = useState<QItem | null>(null);
  const [restoreItem, setRestoreItem] = useState<QItem | null>(null);
  return (
    <Card>
      <CardHeader icon={<ShieldAlert className="size-4.5" />} title="Quarantine" subtitle="Infected files, moved out of the shared folders" />
      {items.length === 0 ? (
        <Empty icon={<ShieldCheck className="size-6" />} title="Nothing in the quarantine" />
      ) : (
        <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px] break-all">{it.path}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <Badge tone="red">{it.virus}</Badge>
                  <span>{bytes(it.size)}</span>
                  <span>· found {dateTime(it.found)}</span>
                </div>
              </div>
              <Menu
                trigger={
                  <IconButton label="Quarantine actions">
                    <MoreHorizontal className="size-5" />
                  </IconButton>
                }
              >
                <MenuItem icon={<RotateCcw />} onClick={() => setRestoreItem(it)}>
                  Restore
                </MenuItem>
                <MenuItem icon={<Trash2 />} danger onClick={() => setConfirm(it)}>
                  Delete
                </MenuItem>
              </Menu>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && del.mutate(confirm.id)}
        loading={del.isPending}
        danger
        title="Delete this file?"
        confirmText="Delete"
        message={confirm ? `${confirm.path} is deleted for good.` : ""}
      />
      <ConfirmDialog
        open={!!restoreItem}
        onClose={() => setRestoreItem(null)}
        onConfirm={() => {
          if (restoreItem) restore.mutate(restoreItem.id);
          setRestoreItem(null);
        }}
        title="Restore this file?"
        confirmText="Restore"
        message="Only restore a file you are sure is safe (a false alarm). It goes back to its folder and the next scan reports it again."
      />
    </Card>
  );
}
