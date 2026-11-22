import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DatabaseBackup, HardDrive, MoreHorizontal, Pencil, Play, Plus, RotateCcw, Square, Trash2, Usb } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime, rate } from "../lib/format";
import { useAction } from "../lib/hooks";
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
  shares: string[];
  when: "plug" | "daily" | "both";
  time: string;
  eject: boolean;
  keep_days: number;
  last: { at: number; ok: boolean; error: string | null; stopped: boolean; duration: number } | null;
  connected: boolean;
  disk: Disk | null;
  snapshots: string[];
  progress: { state: "idle" | "running" | "success" | "error" | "stopped"; share?: string; index?: number; total?: number; percent?: number; speed?: number | null };
};
type Info = { tasks: Task[]; disks: Disk[]; shares: string[]; backup_dir: string };
const KEEP = [7, 14, 30, 90, 365];
const whenText = (t: Pick<Task, "when" | "time">) =>
  t.when === "plug" ? "Runs when the disk is plugged in" : t.when === "daily" ? `Runs every day at ${t.time}` : `Runs when plugged in and every day at ${t.time}`;
const snapLabel = (s: string) =>
  s === "Current" ? "Latest copy" : dateTime(new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(13, 15)).getTime() / 1000);

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
        description="Copy shared folders to another disk"
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
            text="Keep a copy of your shared folders on a USB or internal disk. RAID is not a backup."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard("new")}>
                New backup
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
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
  const p = t.progress;
  const running = p.state === "running";
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
            {t.disk_size ? ` · ${bytes(t.disk_size)}` : ""} · {t.shares.length ? t.shares.join(", ") : "All shared folders"}
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
          <MenuItem icon={<Trash2 />} danger onClick={() => setConfirm(true)}>
            Delete
          </MenuItem>
        </Menu>
      </div>
      <div className="flex-1 space-y-3 px-5 pb-4">
        {running ? (
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
                key={s}
                size="sm"
                onClick={() => navigate(`/browser?${new URLSearchParams({ volume: t.disk!.id, path: `${backupDir}/${s}` })}`)}
              >
                {snapLabel(s)}
              </Button>
            ))}
          </div>
        </Modal>
      )}
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

function Wizard({ info, task, onClose }: { info: Info; task: Task | null; onClose: () => void }) {
  const editing = !!task;
  const [step, setStep] = useState(editing ? 1 : 0);
  // a disk that can keep earlier versions first
  const [disk, setDisk] = useState<string>(task?.disk_uuid ?? (info.disks.find((x) => x.versions) ?? info.disks[0])?.uuid ?? "");
  const [shares, setShares] = useState<string[]>(task?.shares ?? []);
  const [when, setWhen] = useState<Task["when"]>(task?.when ?? "plug");
  const [time, setTime] = useState(task?.time ?? "02:00");
  const [eject, setEject] = useState(task?.eject ?? true);
  const [keep, setKeep] = useState(task?.keep_days ?? 30);
  const d = info.disks.find((x) => x.uuid === disk);
  const [name, setName] = useState(task?.name ?? "");
  const versions = task ? task.versions : !!d?.versions;
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const fallback = !d ? "Backup" : /backup/i.test(d.name) ? d.name : `Backup to ${d.name}`;
  const body = { name: name.trim() || (task?.name ?? fallback), disk_uuid: disk, shares, when, time, eject, keep_days: keep };
  const save = useAction(() => (editing ? api.put(`/backup/${task!.id}`, body) : api.post("/backup", { ...body, run_now: d ? true : false })), {
    invalidate: ["backup"],
    success: editing ? "Backup saved" : "Backup created; the first run has started",
    onSuccess: onClose,
  });
  const steps = ["Disk", "Folders", "When", "Name"];
  const canNext = step === 0 ? !!d : step === 2 ? timeOk || when === "plug" : true;
  const chip = (on: boolean) =>
    cx(
      "rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset transition",
      on ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30" : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5",
    );
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${task!.name}` : "New backup"}
      description={`Step ${step + 1} of 4: ${steps[step]}`}
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
        <div className="space-y-3">
          <p className="text-[13px] text-zinc-500">Which disk? USB and internal disks with a filesystem are listed; a USB disk appears as soon as you plug it in.</p>
          {info.disks.length === 0 ? (
            <Callout tone="info">No disk found. Plug in a USB disk, or connect an internal disk with a filesystem; it appears here within a few seconds.</Callout>
          ) : (
            <div className="grid gap-2">
              {info.disks.map((x) => (
                <button
                  key={x.uuid}
                  type="button"
                  onClick={() => setDisk(x.uuid)}
                  className={cx(
                    "flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition ring-inset",
                    disk === x.uuid ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5",
                  )}
                >
                  {x.kind === "usb" ? <Usb className="size-5 shrink-0 text-zinc-500" /> : <HardDrive className="size-5 shrink-0 text-zinc-500" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold break-words">{x.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {x.media} · {bytes(x.size)} · {x.fs_label}
                      {!x.versions && <span className="text-amber-600 dark:text-amber-400"> · one copy, no earlier versions</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {d && !d.versions && (
            <p className="text-xs text-zinc-500">
              {d.fs_label} cannot keep earlier versions: the backup is one copy, kept up to date. To keep earlier versions, use a disk formatted as ext4, XFS or NTFS.
            </p>
          )}
        </div>
      )}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[13px] text-zinc-500">What should be copied?</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip(shares.length === 0)} onClick={() => setShares([])}>
              All shared folders
            </button>
            {info.shares.map((s) => {
              const on = shares.includes(s);
              return (
                <button key={s} type="button" className={chip(on)} onClick={() => setShares(on ? shares.filter((x) => x !== s) : [...shares, s])}>
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500">Recycle bins are not copied.</p>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-[13px] text-zinc-500">When should it run?</p>
          {(
            [
              ["plug", "Whenever I plug in the disk", "Good for a disk you take home or keep in a drawer"],
              ["daily", "Every day", "For a disk that stays connected"],
              ["both", "Both", "When plugged in, and every day while it stays connected"],
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
              <div className="text-xs text-zinc-500">Then it is safe to unplug; you get an email</div>
            </div>
            <Switch checked={eject} onChange={setEject} label="Eject the disk when done" />
          </div>
          {versions && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
              <div>
                <div className="text-[13.5px] font-medium">Keep earlier versions</div>
                <div className="text-xs text-zinc-500">Each version only stores what changed</div>
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
            <Row k="Disk" v={task ? task.disk_name : d ? `${d.name} (${d.fs_label})` : "—"} />
            <Row k="Folders" v={shares.length ? shares.join(", ") : "All shared folders"} />
            <Row k="When" v={whenText({ when, time })} />
            <Row k="Versions" v={versions ? `Kept for ${keep === 365 ? "1 year" : `${keep} days`}` : "One copy, kept up to date"} />
            <Row k="Afterwards" v={eject ? "Eject the disk" : "Leave it connected"} />
          </dl>
          <p className="text-xs text-zinc-500">On the disk, backups are in the folder Talon Backup.</p>
        </div>
      )}
    </Modal>
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

