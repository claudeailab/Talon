import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ChevronDown, DatabaseBackup, FileText, HardDrive, Minus, MoreHorizontal, Pencil, Play, Plus, RotateCcw, Square, Trash2, Usb } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime, rate } from "../lib/format";
import { useAction } from "../lib/hooks";
import { LogList } from "../components/log";
import { navigate } from "../lib/router";
import { Badge, Button, Callout, Card, ConfirmDialog, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, PageLoader, Progress, Select, Switch } from "../components/ui";

type Disk = { uuid: string; id: string; dev: string; name: string; media: string; fstype: string; fs_label: string; size: number; kind: string; versions: boolean };
type Task = {
  id: string;
  name: string;
  disk_uuid: string;
  disk_name: string;
  disk_size: number;
  versions: boolean;
  sources: Source[];
  when: "plug" | "daily" | "both";
  time: string;
  eject: boolean;
  keep_days: number;
  last: { at: number; ok: boolean; error: string | null; stopped: boolean; duration: number } | null;
  connected: boolean;
  disk: Disk | null;
  /** newest first; "at" is null for the single copy on FAT32 / exFAT (Current) */
  snapshots: { name: string; at: number | null }[];
  progress: { state: "idle" | "running" | "success" | "error" | "stopped"; share?: string; index?: number; total?: number; percent?: number; speed?: number | null };
};
type Blank = { disk: string; name: string; media: string; size: number; kind: string; state: "Empty" | "Has data" | "Old RAID" };
/** a whole volume (no folders) or folders on it */
type Source = { volume: string; folders: string[] };
type VolumeSrc = { volume: string; used: number; folders: { name: string; size: number | null }[] };
type Info = { tasks: Task[]; disks: Disk[]; prepare: Blank[]; sources: VolumeSrc[]; backup_dir: string };
const describe = (src: Source[]) => src.map((x) => (x.folders.length ? `${x.volume}: ${x.folders.join(", ")}` : x.volume)).join(" · ");
const KEEP = [7, 14, 30, 90, 365];
const whenText = (t: Pick<Task, "when" | "time">) =>
  t.when === "plug" ? "Runs when the disk is plugged in" : t.when === "daily" ? `Runs every day at ${t.time}` : `Runs when plugged in and every day at ${t.time}`;
const snapLabel = (s: Task["snapshots"][number]) => (s.at == null ? "Latest copy" : dateTime(s.at));

export default function BackupPage() {
  const q = useQuery({
    queryKey: ["backup"],
    queryFn: () => api.get<Info>("/backup"),
    refetchInterval: (query) => (query.state.data?.tasks.some((t) => t.progress.state === "running") ? 1000 : 10000),
  });
  const [wizard, setWizard] = useState<Task | "new" | null>(null);
  if (!q.data) return <PageLoader />;
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Backup"
        description="Copy volumes and folders to another disk"
        actions={
          d.tasks.length > 0 && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard("new")}>
              New backup
            </Button>
          )
        }
      />
      {d.tasks.length === 0 ? (
        <Card>
          <Empty
            icon={<DatabaseBackup className="size-6" />}
            title="No backups yet"
            text="Keep a copy on a USB or internal disk. RAID is not a backup."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard("new")}>
                New backup
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5">
          {d.tasks.map((t) => (
            <TaskCard key={t.id} t={t} onEdit={() => setWizard(t)} backupDir={d.backup_dir} />
          ))}
        </div>
      )}
      {wizard && <Wizard info={d} task={wizard === "new" ? null : wizard} onClose={() => setWizard(null)} />}
    </>
  );
}

function TaskCard({ t, onEdit, backupDir }: { t: Task; onEdit: () => void; backupDir: string }) {
  const run = useAction(() => api.post(`/backup/${t.id}/run`), { invalidate: ["backup"] });
  const stop = useAction(() => api.post(`/backup/${t.id}/stop`), { invalidate: ["backup"] });
  const del = useAction(() => api.del(`/backup/${t.id}`), { invalidate: ["backup"], success: "Backup deleted", onSuccess: () => setConfirm(false) });
  const [confirm, setConfirm] = useState(false);
  const [restore, setRestore] = useState(false);
  const [log, setLog] = useState(false);
  const running = t.progress.state === "running";
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 p-5 pb-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
          {t.disk && t.disk.kind !== "usb" ? <HardDrive className="size-5" /> : <Usb className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold break-words">{t.name}</h3>
            {t.connected ? <Badge tone="green" dot>Connected</Badge> : <Badge dot>Not connected</Badge>}
          </div>
          <p className="text-[13px] break-words text-zinc-500">
            {t.disk ? `${t.disk.media}: ` : ""}
            {t.disk_name}
            {t.disk_size ? ` · ${bytes(t.disk_size)}` : ""} · {describe(t.sources)}
          </p>
        </div>
        <Menu
          trigger={
            <IconButton label={`Actions for ${t.name}`}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          }
        >
          <MenuItem icon={<Pencil />} onClick={onEdit}>
            Edit
          </MenuItem>
          <MenuItem icon={<FileText />} onClick={() => setLog(true)}>
            View log
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onClick={() => setConfirm(true)}>
            Delete
          </MenuItem>
        </Menu>
      </div>
      <div className="flex-1 space-y-3 px-5 pb-4">
        {running ? (
          <RunProgress p={t.progress} />
        ) : t.last ? (
          <div className="text-[13px]">
            <span className="font-medium">Last backup</span>{" "}
            <span className={cx(t.last.ok ? "text-zinc-500" : "text-rose-600 dark:text-rose-400")}>
              {ago(t.last.at)}
              {t.last.ok ? "" : t.last.stopped ? " · stopped" : ` · failed: ${t.last.error}`}
            </span>
          </div>
        ) : (
          <div className="text-[13px] text-zinc-500">Not backed up yet</div>
        )}
        {t.disk && !t.disk.versions && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t.disk.fs_label} keeps one copy, without earlier versions.
          </p>
        )}
        {t.versions && t.snapshots.length > 0 && <div className="text-xs text-zinc-500">{t.snapshots.length} version{t.snapshots.length === 1 ? "" : "s"} kept · up to {t.keep_days} days</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-5 py-3 dark:border-white/5">
        {running ? (
          <Button size="sm" icon={<Square className="size-3.5" />} loading={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} disabled={!t.connected} loading={run.isPending} onClick={() => run.mutate()}>
            Back up now
          </Button>
        )}
        <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={!t.connected || !t.snapshots.length || running} onClick={() => setRestore(true)}>
          Restore
        </Button>
        <span className="ml-auto text-xs text-zinc-500">{whenText(t)}</span>
      </div>
      {restore && t.disk && (
        <Modal open onClose={() => setRestore(false)} title="Restore" description="Choose a version; it opens in Files, where you can copy back a file, a folder or everything">
          <div className="flex flex-wrap gap-2">
            {t.snapshots.map((s) => (
              <Button
                key={s.name}
                size="sm"
                onClick={() => navigate(`/browser?${new URLSearchParams({ volume: t.disk!.id, path: `${backupDir}/${s.name}` })}`)}
              >
                {snapLabel(s)}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {log && <LogDialog t={t} onClose={() => setLog(false)} />}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        danger
        title={`Delete ${t.name}?`}
        confirmText="Delete"
        message="Only the backup task is deleted. The backups already on the disk stay there."
      />
    </Card>
  );
}

/** Which folder is being copied, how far the run is and how fast it goes. */
function RunProgress({ p }: { p: Task["progress"] }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3.5 dark:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0 font-medium break-words">
          Backing up {p.share} · {(p.index ?? 0) + 1} of {p.total}
        </span>
        <span className="tabular shrink-0 font-semibold text-zinc-500">{Math.round(p.percent ?? 0)}%</span>
      </div>
      <Progress value={p.percent ?? 0} className="mt-2 h-2" />
      {p.speed ? <div className="mt-1 text-xs text-zinc-500">{rate(p.speed)}</div> : null}
    </div>
  );
}

/** The running or the last run's log, as for OneDrive tasks: every file copied or deleted, and any error. */
function LogDialog({ t, onClose }: { t: Task; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["backup-log", t.id],
    queryFn: () => api.get<string[]>(`/backup/${t.id}/log`),
    refetchInterval: 2000,
  });
  const running = t.progress.state === "running";
  return (
    <Modal open onClose={onClose} size="lg" title={`Log: ${t.name}`} footer={<Button onClick={onClose}>Close</Button>}>
      {/* the last run's error, until the backup runs again */}
      {!running && t.last && !t.last.ok && !t.last.stopped && t.last.error && (
        <Callout tone="danger" title={`Last run failed on ${dateTime(t.last.at)}`} className="mb-3">
          {t.last.error}
        </Callout>
      )}
      {running && (
        <div className="mb-3">
          <RunProgress p={t.progress} />
        </div>
      )}
      <LogList lines={q.data} />
    </Modal>
  );
}

function Wizard({ info, task, onClose }: { info: Info; task: Task | null; onClose: () => void }) {
  const editing = !!task;
  const [step, setStep] = useState(editing ? 1 : 0);
  // a disk that can keep earlier versions first
  const [disk, setDisk] = useState<string>(task?.disk_uuid ?? (info.disks.find((x) => x.versions) ?? info.disks[0])?.uuid ?? "");
  // an empty disk Talon erases and formats for backups (ext4) when the backup is created
  const [prep, setPrep] = useState<string | null>(null);
  const [erase, setErase] = useState(false);
  const blank = info.prepare.find((b) => b.disk === prep);
  const pick = (uuid: string | null, dev: string | null) => {
    setDisk(uuid ?? "");
    setPrep(dev);
    setErase(false);
  };
  // volume -> "all", or the chosen folders on it
  const [sel, setSel] = useState<Record<string, "all" | string[]>>(() =>
    Object.fromEntries(task ? task.sources.map((x) => [x.volume, x.folders.length ? x.folders : "all"]) : info.sources.map((v) => [v.volume, "all"])),
  );
  const sources: Source[] = Object.entries(sel)
    .filter(([, v]) => v === "all" || v.length > 0)
    .map(([volume, v]) => ({ volume, folders: v === "all" ? [] : v }));
  const [when, setWhen] = useState<Task["when"]>(task?.when ?? "plug");
  const [time, setTime] = useState(task?.time ?? "02:00");
  const [eject, setEject] = useState(task?.eject ?? true);
  const [keep, setKeep] = useState(task?.keep_days ?? 30);
  const d = info.disks.find((x) => x.uuid === disk);
  const [name, setName] = useState(task?.name ?? "");
  const versions = task ? task.versions : blank ? true : !!d?.versions;
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const target = blank?.name ?? d?.name;
  const fallback = !target ? "Backup" : /backup/i.test(target) ? target : `Backup to ${target}`;
  const body = { name: name.trim() || (task?.name ?? fallback), disk_uuid: disk, sources, when, time, eject, keep_days: keep };
  const save = useAction(
    () => (editing ? api.put(`/backup/${task!.id}`, body) : api.post("/backup", { ...body, ...(blank ? { prepare_disk: blank.disk } : {}), run_now: true })),
    {
      invalidate: ["backup"],
      success: editing ? "Backup saved" : blank ? `Preparing ${blank.disk}; the first backup follows` : "Backup created; the first run has started",
      onSuccess: onClose,
    },
  );
  const steps = ["Disk", "What to back up", "When", "Name"];
  const canNext = step === 0 ? !!d || (!!blank && erase) : step === 1 ? sources.length > 0 : step === 2 ? timeOk || when === "plug" : true;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${task!.name}` : "New backup"}
      description={`Step ${step + 1} of 4 · ${steps[step]}`}
      footer={
        <>
          {step > (editing ? 1 : 0) ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {editing ? "Save" : "Create and back up now"}
            </Button>
          )}
        </>
      }
    >
      {step === 0 && (
        <div className="space-y-2">
          {info.disks.length === 0 && info.prepare.length === 0 && <Callout tone="info">Plug in a USB disk; it appears here within a few seconds.</Callout>}
          {info.disks.length > 0 && <Heading>Ready</Heading>}
          {info.disks.map((x) => (
            <DiskChoice
              key={x.uuid}
              on={disk === x.uuid && !prep}
              onClick={() => pick(x.uuid, null)}
              usb={x.kind === "usb"}
              name={x.name}
              chip={<Badge tone="green">{x.fs_label}</Badge>}
              detail={`${x.media} · ${x.versions ? "keeps earlier versions" : "one copy, no versions"}`}
              size={x.size}
            />
          ))}
          {info.prepare.length > 0 && <Heading>Prepared when chosen</Heading>}
          {info.prepare.map((x) => (
            <DiskChoice
              key={x.disk}
              on={prep === x.disk}
              onClick={() => pick(null, x.disk)}
              usb={x.kind === "usb"}
              name={x.name}
              chip={<Badge tone="amber">{x.state}</Badge>}
              detail={`${x.media} · ${x.disk}`}
              size={x.size}
            />
          ))}
          {blank && (
            <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20">
              <input type="checkbox" className="size-4 accent-rose-600" checked={erase} onChange={(e) => setErase(e.target.checked)} />
              <span>
                Erase <b>{blank.disk}</b> and prepare it for backups
              </span>
            </label>
          )}
        </div>
      )}
      {step === 1 && <SourcePicker volumes={info.sources} sel={sel} onChange={setSel} />}
      {step === 2 && (
        <div className="space-y-3">
          {(
            [
              ["plug", "Whenever I plug in the disk", "For a disk you keep elsewhere"],
              ["daily", "Every day", "For a disk that stays connected"],
              ["both", "Both", "When plugged in, and every day"],
            ] as const
          ).map(([v, t, s]) => (
            <button
              key={v}
              type="button"
              onClick={() => setWhen(v)}
              className={cx(
                "block w-full rounded-xl p-3 text-left ring-1 transition ring-inset",
                when === v ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5",
              )}
            >
              <span className="block text-[13.5px] font-semibold">{t}</span>
              <span className="block text-xs text-zinc-500">{s}</span>
            </button>
          ))}
          {when !== "plug" && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-zinc-500">at</span>
              <Input value={time} onChange={(e) => setTime(e.target.value)} className="w-24" aria-label="Time" />
              {!timeOk && <span className="text-xs text-rose-600">Use hh:mm, 24-hour</span>}
            </div>
          )}
          <div className="flex items-start justify-between gap-4 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
            <div>
              <div className="text-[13.5px] font-medium">Eject the disk when done</div>
              <div className="text-xs text-zinc-500">Safe to unplug afterwards</div>
            </div>
            <Switch checked={eject} onChange={setEject} label="Eject the disk when done" />
          </div>
          {versions && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
              <div>
                <div className="text-[13.5px] font-medium">Keep earlier versions</div>
                <div className="text-xs text-zinc-500">Only changes take space</div>
              </div>
              <Select value={keep} onChange={(e) => setKeep(Number(e.target.value))} className="w-36" aria-label="Keep versions">
                {KEEP.map((k) => (
                  <option key={k} value={k}>
                    {k === 365 ? "1 year" : `${k} days`}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={body.name} maxLength={60} />
          </Field>
          <dl className="space-y-1.5 rounded-xl bg-zinc-50 p-3.5 text-[13px] dark:bg-white/[0.03]">
            <Row k="Disk" v={task ? task.disk_name : blank ? `${blank.name} (erased and prepared)` : d ? `${d.name} (${d.fs_label})` : "—"} />
            <Row k="What" v={describe(sources)} />
            <Row k="When" v={whenText({ when, time })} />
            <Row k="Versions" v={versions ? `Kept for ${keep === 365 ? "1 year" : `${keep} days`}` : "One copy, kept up to date"} />
            <Row k="Afterwards" v={eject ? "Eject the disk" : "Leave it connected"} />
          </dl>
        </div>
      )}
    </Modal>
  );
}

/** Whole volumes, or folders on them, with their sizes and the total. */
function SourcePicker({ volumes, sel, onChange }: { volumes: VolumeSrc[]; sel: Record<string, "all" | string[]>; onChange: (s: Record<string, "all" | string[]>) => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!volumes.length) return <Callout tone="info">Create a volume first.</Callout>;
  const size = (v: VolumeSrc, f: string) => v.folders.find((x) => x.name === f)?.size ?? 0;
  const total = volumes.reduce((sum, v) => {
    const s = sel[v.volume];
    return sum + (s === "all" ? v.used : (s ?? []).reduce((a, f) => a + size(v, f), 0));
  }, 0);
  const box = (state: "on" | "part" | "off") => (
    <span
      className={cx(
        "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] text-white",
        state === "off" ? "ring-1 ring-zinc-300 ring-inset dark:ring-white/20" : "bg-brand-600",
      )}
    >
      {state === "on" ? <Check className="size-3" strokeWidth={3} /> : state === "part" ? <Minus className="size-3" strokeWidth={3} /> : null}
    </span>
  );
  return (
    <div>
      <div className="max-h-[22rem] space-y-2 overflow-y-auto">
        {volumes.map((v) => {
          const s = sel[v.volume];
          const all = s === "all";
          const chosen = all ? v.folders.map((f) => f.name) : (s ?? []);
          const state = all ? "on" : chosen.length ? "part" : "off";
          const open = !closed[v.volume] && v.folders.length > 0;
          const toggleFolder = (f: string) => {
            const next = chosen.includes(f) ? chosen.filter((x) => x !== f) : [...chosen, f];
            // every folder ticked is the whole volume (folders added later included)
            onChange({ ...sel, [v.volume]: next.length === v.folders.length ? "all" : next });
          };
          return (
            <div key={v.volume} className="overflow-hidden rounded-xl ring-1 ring-zinc-200 ring-inset dark:ring-white/10">
              <div className="flex items-center gap-3 bg-zinc-50 px-3 py-2.5 dark:bg-white/[0.03]">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onChange({ ...sel, [v.volume]: all ? [] : "all" })}>
                  {box(state)}
                  <span className="text-[13.5px] font-semibold break-words">{v.volume}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {all ? `Whole volume · ${bytes(v.used)}` : chosen.length ? `${chosen.length} of ${v.folders.length} folders` : "Not included"}
                  </span>
                </button>
                {v.folders.length > 0 && (
                  <button type="button" aria-label={open ? "Hide folders" : "Show folders"} onClick={() => setClosed({ ...closed, [v.volume]: open })} className="text-zinc-400 hover:text-zinc-600">
                    <ChevronDown className={cx("size-4 transition", open && "rotate-180")} />
                  </button>
                )}
              </div>
              {open &&
                v.folders.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => toggleFolder(f.name)}
                    className="flex w-full items-center gap-3 border-t border-zinc-100 py-2 pr-10 pl-10 text-left text-[13.5px] hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.03]"
                  >
                    {box(chosen.includes(f.name) ? "on" : "off")}
                    <span className="min-w-0 break-words">{f.name}</span>
                    <span className="ml-auto text-xs text-zinc-500">{f.size == null ? "…" : bytes(f.size)}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-zinc-500">{bytes(total)} selected</div>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return <div className="pt-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase first:pt-0 dark:text-zinc-500">{children}</div>;
}

function DiskChoice({ on, onClick, usb, name, chip, detail, size }: { on: boolean; onClick: () => void; usb: boolean; name: string; chip: React.ReactNode; detail: string; size: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition ring-inset",
        on ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5",
      )}
    >
      <span className={cx("size-4 shrink-0 rounded-full ring-1", on ? "bg-brand-600 ring-brand-600 shadow-[inset_0_0_0_3px_white] dark:shadow-[inset_0_0_0_3px_#18181b]" : "ring-zinc-300 dark:ring-white/20")} />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/5">
        {usb ? <Usb className="size-4.5" /> : <HardDrive className="size-4.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold break-words">
          {name} {chip}
        </span>
        <span className="block text-xs text-zinc-500">{detail}</span>
      </span>
      <span className="tabular shrink-0 text-[13px] font-semibold">{bytes(size)}</span>
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-right font-medium break-words">{v}</dd>
    </div>
  );
}

