import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MoreHorizontal, Play, RotateCcw, ShieldAlert, ShieldCheck, Square, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime, duration } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Volume } from "../lib/types";
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, IconButton, Input, Menu, MenuItem, PageHeader, PageLoader, Progress, Segmented, Select } from "../components/ui";

type QItem = { id: string; path: string; virus: string; found: number; size: number };
type AvInfo = {
  installed: boolean;
  version: string | null;
  db_date: number | null;
  definitions: boolean;
  ram: number;
  ram_ok: boolean;
  ram_warning: boolean;
  progress: { state: "idle" | "running" | "success" | "error" | "stopped"; phase?: string; done?: number; total?: number; found?: number; file?: string; error?: string; volumes?: string[] };
  settings: { volumes: string[]; schedule: "off" | "daily" | "weekly"; time: string; weekday: number };
  last_scan: { at: number; duration: number; files: number; found: number; volumes: string[]; stopped: boolean; error: string | null } | null;
  quarantine: QItem[];
  setup: { state: "idle" | "running" | "success" | "error"; action?: "install" | "remove"; percent?: number; text?: string; error?: string };
  updates: string | null;
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const chip = (on: boolean) =>
  cx(
    "rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset transition",
    on ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30" : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5",
  );

/** One card: status, what to scan, scan now, the schedule, and the quarantine when it holds something. */
export default function AntivirusPage() {
  const q = useQuery({
    queryKey: ["antivirus"],
    queryFn: () => api.get<AvInfo>("/antivirus"),
    refetchInterval: (query) => (query.state.data?.progress.state === "running" || query.state.data?.setup.state === "running" ? 1000 : 15000),
  });
  const vols = useQuery({ queryKey: ["volumes"], queryFn: () => api.get<Volume[]>("/volumes") });
  const [remove, setRemove] = useState(false);
  const install = useAction(() => api.post<AvInfo>("/antivirus/install"), { invalidate: ["antivirus"] });
  const uninstall = useAction(() => api.post<AvInfo>("/antivirus/remove"), { invalidate: ["antivirus"], onSuccess: () => setRemove(false) });
  if (!q.data || !vols.data) return <PageLoader />;
  const d = q.data;
  const ready = d.installed && d.setup.state !== "running";
  return (
    <>
      <PageHeader title="Antivirus" description="Scan volumes for viruses" />
      <Card>
        <CardHeader
          icon={<ShieldCheck className="size-4.5" />}
          title="ClamAV"
          subtitle={
            ready
              ? `Version ${d.version ?? "?"} · definitions ${d.db_date ? `updated ${ago(d.db_date)}` : d.definitions ? "installed" : "downloading"}, checked ${d.updates}`
              : "Free, open-source antivirus by Cisco Talos"
          }
          actions={
            ready && (
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
        <div className="px-5 pb-5">
          {d.setup.state === "running" ? (
            <ProgressBox title={d.setup.action === "remove" ? "Removing ClamAV" : "Installing ClamAV"} text={d.setup.text} percent={d.setup.percent} note="You can leave this page; it continues in the background." />
          ) : !d.installed ? (
            <div className="space-y-3">
              {d.setup.state === "error" && <Callout tone="danger" title="The installation failed">{d.setup.error}</Callout>}
              <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
                Scans your volumes on demand or on a schedule. A scan uses about 1.5 GB of memory while it runs. Downloads about 300 MB, including the virus definitions.
              </p>
              {!d.ram_ok && <Callout tone="warning" title="Not enough memory">This NAS has {bytes(d.ram)} of memory. ClamAV needs at least 2 GB.</Callout>}
              {d.ram_ok && d.ram_warning && <Callout tone="warning">This NAS has {bytes(d.ram)} of memory; ClamAV recommends 3 GB or more.</Callout>}
              <Button variant="primary" disabled={!d.ram_ok} loading={install.isPending} onClick={() => install.mutate()}>
                Install ClamAV
              </Button>
            </div>
          ) : (
            <Scanner d={d} volumes={vols.data} />
          )}
        </div>
        {ready && d.quarantine.length > 0 && <Quarantine items={d.quarantine} />}
      </Card>
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

function ProgressBox({ title, text, percent, note, action }: { title: string; text?: string; percent?: number; note?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {text && <div className="text-[13px] break-words text-zinc-500">{text}</div>}
        </div>
        {action ?? <span className="tabular text-sm font-semibold text-zinc-500">{Math.round(percent ?? 0)}%</span>}
      </div>
      <Progress value={percent ?? 0} className="mt-3 h-2" />
      {note && <div className="mt-2 text-xs text-zinc-500 [overflow-wrap:anywhere]">{note}</div>}
    </div>
  );
}

/** Volumes, Scan now and the schedule; changes to the schedule save by themselves. */
function Scanner({ d, volumes }: { d: AvInfo; volumes: Volume[] }) {
  const [sel, setSel] = useState<string[]>(d.settings.volumes);
  const [time, setTime] = useState(d.settings.time);
  useEffect(() => setTime(d.settings.time), [d.settings.time]);
  const save = useAction((body: Partial<AvInfo["settings"]>) => api.put<AvInfo>("/antivirus/settings", { ...d.settings, ...body }), {
    invalidate: ["antivirus"],
    success: "Saved",
  });
  const scan = useAction(() => api.post<AvInfo>("/antivirus/scan", { volumes: sel }), { invalidate: ["antivirus"] });
  const stop = useAction(() => api.post("/antivirus/stop"), { invalidate: ["antivirus"] });
  const pickVolumes = (v: string[]) => {
    setSel(v);
    save.mutate({ volumes: v });          // the schedule scans the same volumes
  };
  const p = d.progress;
  const last = d.last_scan;
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return (
    <div className="space-y-4">
      {p.state === "running" ? (
        <ProgressBox
          title={p.phase === "counting" ? "Counting files…" : p.phase === "loading" ? "Loading the virus definitions…" : `Scanning ${p.volumes?.join(", ")}`}
          text={`${(p.done ?? 0).toLocaleString()} of ${(p.total ?? 0).toLocaleString()} files · ${p.found ? `${p.found} infected` : "nothing found so far"}`}
          percent={p.total ? ((p.done ?? 0) / p.total) * 100 : 0}
          note={p.file}
          action={
            <Button size="sm" icon={<Square className="size-3.5" />} loading={stop.isPending} onClick={() => stop.mutate()}>
              Stop
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip(sel.length === 0)} onClick={() => pickVolumes([])}>
              All volumes
            </button>
            {volumes.map((v) => {
              const on = sel.includes(v.name);
              return (
                <button key={v.name} type="button" className={chip(on)} onClick={() => pickVolumes(on ? sel.filter((x) => x !== v.name) : [...sel, v.name])}>
                  {v.name}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="primary" icon={<Play className="size-4" />} loading={scan.isPending} disabled={!d.definitions && !d.db_date} onClick={() => scan.mutate()}>
              Scan now
            </Button>
            {last && (
              <span className={cx("text-[13px]", last.found ? "font-medium text-rose-600 dark:text-rose-400" : "text-zinc-500")}>
                {last.found
                  ? `Last scan found ${last.found} infected file${last.found > 1 ? "s" : ""}`
                  : last.error
                    ? `Last scan failed: ${last.error}`
                    : `Last scan ${last.stopped ? "stopped" : "found nothing"}`}{" "}
                · {last.files.toLocaleString()} files · {dateTime(last.at)} · {last.duration < 60 ? "under a minute" : duration(last.duration)}
              </span>
            )}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-100 pt-4 dark:border-white/5">
        <span className="text-[13px] font-medium">Scheduled scan</span>
        <Segmented
          size="sm"
          value={d.settings.schedule}
          onChange={(v) => save.mutate({ schedule: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ]}
        />
        {d.settings.schedule !== "off" && (
          // day and time stay together on one line, also on a phone
          <div className="flex items-center gap-2">
            {d.settings.schedule === "weekly" && (
              <div className="w-36 shrink-0">
                <Select value={d.settings.weekday} onChange={(e) => save.mutate({ weekday: Number(e.target.value) })} aria-label="Day">
                  {DAYS.map((day, i) => (
                    <option key={day} value={i}>{day}</option>
                  ))}
                </Select>
              </div>
            )}
            <span className="text-[13px] text-zinc-500">at</span>
            <div className="w-20 shrink-0">
              <Input value={time} onChange={(e) => setTime(e.target.value)} onBlur={() => timeOk && time !== d.settings.time && save.mutate({ time })} aria-label="Time" />
            </div>
            {!timeOk && <span className="text-xs text-rose-600">Use hh:mm</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Quarantine({ items }: { items: QItem[] }) {
  const restore = useAction((id: string) => api.post(`/antivirus/quarantine/${id}/restore`), { invalidate: ["antivirus"], success: "Restored to its folder" });
  const del = useAction((id: string) => api.del(`/antivirus/quarantine/${id}`), { invalidate: ["antivirus"], success: "Deleted", onSuccess: () => setConfirm(null) });
  const [confirm, setConfirm] = useState<QItem | null>(null);
  const [restoreItem, setRestoreItem] = useState<QItem | null>(null);
  return (
    <div className="border-t border-zinc-100 px-5 pt-4 pb-2 dark:border-white/5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className="size-4 text-rose-500" /> Quarantine <Badge tone="red">{items.length}</Badge>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
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
    </div>
  );
}
