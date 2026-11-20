import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  Database,
  Expand,
  MoreHorizontal,
  Plus,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, dateTime, levelLabel, pct } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Disk, Job, RaidOption, Volume } from "../lib/types";
import { CapacityBar } from "../components/charts";
import { DiskIcon, kindLabel } from "../components/disk";
import { JobDialog } from "../components/jobs";
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  Modal,
  PageHeader,
  PageLoader,
  Progress,
  Segmented,
  usageTone,
} from "../components/ui";

export function VolumeStatusBadge({ v }: { v: Pick<Volume, "status"> }) {
  const map: Record<Volume["status"], [string, "green" | "amber" | "red" | "blue" | "violet"]> = {
    healthy: ["Healthy", "green"],
    degraded: ["Degraded", "amber"],
    rebuilding: ["Rebuilding", "blue"],
    reshaping: ["Expanding", "blue"],
    syncing: ["Syncing", "blue"],
    checking: ["Scrubbing", "violet"],
    failed: ["Failed", "red"],
    missing: ["Missing", "red"],
    unmounted: ["Not mounted", "amber"],
  };
  const [label, tone] = map[v.status] ?? [v.status, "amber"];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export default function VolumesPage() {
  const vols = useQuery({ queryKey: ["volumes"], queryFn: () => api.get<Volume[]>("/volumes"), refetchInterval: 4000 });
  const disks = useQuery({ queryKey: ["disks"], queryFn: () => api.get<Disk[]>("/disks"), refetchInterval: 15000 });
  const [wizard, setWizard] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  if (!vols.data || !disks.data) return <PageLoader />;
  const free = disks.data.filter((d) => d.selectable);

  return (
    <>
      <PageHeader
        title="Volumes & RAID"
        description="Combine disks into protected storage volumes. Shared folders live on volumes."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard(true)} disabled={!free.length}>
            Create volume
          </Button>
        }
      />
      {!free.length && vols.data.length === 0 && (
        <Callout tone="warning" className="mb-6" title="No unused disks found">
          Connect additional disks to this computer. The disk the operating system runs from can't be used for a volume.
        </Callout>
      )}
      {vols.data.length === 0 ? (
        <Card>
          <Empty
            icon={<Database className="size-6" />}
            title="No volumes yet"
            text={`${free.length} disk${free.length === 1 ? "" : "s"} available. Create a volume to start storing data.`}
            action={
              free.length > 0 && (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>
                  Create volume
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 2xl:grid-cols-2">
          {vols.data.map((v) => (
            <VolumeCard key={v.name} v={v} disks={disks.data} onJob={setJob} />
          ))}
        </div>
      )}
      {wizard && (
        <CreateWizard
          disks={disks.data}
          existing={vols.data.map((v) => v.name)}
          onClose={() => setWizard(false)}
          onJob={(id) => {
            setWizard(false);
            setJob(id);
          }}
        />
      )}
      <JobDialog jobId={job} onClose={() => setJob(null)} />
    </>
  );
}

/* ====================================================================== card */

function memberTone(state: string) {
  return state === "active" ? "green" : state === "spare" ? "blue" : state === "rebuilding" ? "violet" : "red";
}

function VolumeCard({ v, disks, onJob }: { v: Volume; disks: Disk[]; onJob: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addDisk, setAddDisk] = useState(false);
  const [removePart, setRemovePart] = useState<string | null>(null);
  const p = pct(v.used, v.size);
  const isRaid = v.level !== "single";
  const busy = v.array && v.array.sync_action !== "idle";

  const del = useAction(() => api.del<Job>(`/volumes/${v.name}`), {
    invalidate: ["volumes"],
    onSuccess: (j) => {
      setConfirmDelete(false);
      onJob(j.id);
    },
  });
  const scrub = useAction((action: string) => api.post(`/volumes/${v.name}/scrub`, { action }), {
    success: (_r, a) => (a === "check" ? "Data scrub started" : "Data scrub stopped"),
    invalidate: ["volumes"],
  });
  const expand = useAction(() => api.post<Job>(`/volumes/${v.name}/expand`), { onSuccess: (j) => onJob(j.id) });
  const remove = useAction((part: string) => api.del<Job>(`/volumes/${v.name}/members/${part}`), {
    onSuccess: (j) => {
      setRemovePart(null);
      onJob(j.id);
    },
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-md shadow-brand-500/20">
            <Database className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{v.name}</h3>
              <VolumeStatusBadge v={v} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{levelLabel[v.level]}</span>
              <span>·</span>
              <span>{v.fs.toUpperCase()}</span>
              <span>·</span>
              <span className="font-mono text-xs">{v.mountpoint}</span>
            </div>
          </div>
        </div>
        <Menu
          trigger={
            <IconButton label="Volume actions">
              <MoreHorizontal className="size-5" />
            </IconButton>
          }
        >
          {isRaid && (
            <MenuItem icon={<Plus />} onClick={() => setAddDisk(true)}>
              {v.status === "degraded" ? "Replace failed disk" : "Add disk"}
            </MenuItem>
          )}
          {isRaid && v.level !== "raid0" && v.array?.sync_action === "idle" && (
            <MenuItem icon={<ScanSearch />} onClick={() => scrub.mutate("check")}>
              Run data scrub
            </MenuItem>
          )}
          {isRaid && v.array?.sync_action === "check" && (
            <MenuItem icon={<ScanSearch />} onClick={() => scrub.mutate("idle")}>
              Stop data scrub
            </MenuItem>
          )}
          {v.can_expand_fs && (
            <MenuItem icon={<Expand />} onClick={() => expand.mutate()}>
              Expand filesystem
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 />} danger onClick={() => setConfirmDelete(true)}>
            Delete volume
          </MenuItem>
        </Menu>
      </div>

      {v.status_detail && v.status !== "healthy" && (
        <div className="px-5 pb-3">
          <Callout tone={["failed", "missing"].includes(v.status) ? "danger" : v.status === "degraded" || v.status === "unmounted" ? "warning" : "info"}>
            {v.status_detail}
          </Callout>
        </div>
      )}

      {busy && v.array?.sync_progress != null && (
        <div className="px-5 pb-4">
          <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
            <span className="capitalize">{v.array.sync_action === "check" ? "Scrubbing" : v.array.sync_action}</span>
            <span className="tabular">
              {v.array.sync_progress.toFixed(1)}% · {(v.array.sync_speed_kbs / 1000).toFixed(0)} MB/s
            </span>
          </div>
          <Progress value={v.array.sync_progress} tone="blue" />
        </div>
      )}

      <div className="px-5 pb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <span className="tabular text-2xl font-semibold tracking-tight">{bytes(v.used)}</span>
            <span className="ml-1.5 text-sm text-zinc-500">of {bytes(v.size)} used</span>
          </div>
          <span className="tabular text-sm font-medium text-zinc-500">{p.toFixed(1)}%</span>
        </div>
        <Progress value={p} tone={usageTone(p)} className="h-2.5" />
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          {[
            ["Free", bytes(v.free)],
            ["Disks", String(v.members.filter((m) => m.state !== "spare").length)],
            ["Survives", v.fault_tolerance ? `${v.fault_tolerance} disk failure${v.fault_tolerance > 1 ? "s" : ""}` : "No failures"],
          ].map(([k, val]) => (
            <div key={k} className="rounded-xl bg-zinc-50 px-2 py-2.5 dark:bg-white/[0.03]">
              <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{k}</div>
              <div className="tabular mt-0.5 text-[13px] font-semibold">{val}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-white/5 dark:bg-white/[0.015]">
        <div className="mb-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Member disks</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {v.members.map((m) => (
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
              {isRaid && v.members.length > 1 && (
                <IconButton label={`Remove ${m.disk}`} className="size-8 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setRemovePart(m.part)}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        {v.shares.length > 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            Shared folders: <span className="font-medium text-zinc-700 dark:text-zinc-300">{v.shares.join(", ")}</span>
          </div>
        )}
        {v.created && <div className="mt-1 text-xs text-zinc-400">Created {dateTime(v.created)}</div>}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        danger
        title={`Delete volume ${v.name}?`}
        confirmText="Delete volume"
        typeToConfirm={v.name}
        message={
          <>
            All data on <b>{v.name}</b> will be <b>permanently erased</b> and its disks ({v.members.map((m) => m.disk).join(", ")}) wiped.
            {v.shares.length > 0 && (
              <Callout tone="warning" className="mt-3">
                Delete its shared folders first: {v.shares.join(", ")}
              </Callout>
            )}
          </>
        }
      />
      <ConfirmDialog
        open={!!removePart}
        onClose={() => setRemovePart(null)}
        onConfirm={() => removePart && remove.mutate(removePart)}
        loading={remove.isPending}
        danger
        title="Remove disk from volume?"
        confirmText="Remove disk"
        message={
          <>
            The disk will be removed from <b>{v.name}</b> and wiped. If it is an active member the volume becomes
            <b> degraded</b> until you add a replacement disk.
          </>
        }
      />
      {addDisk && <AddDiskDialog v={v} disks={disks} onClose={() => setAddDisk(false)} onJob={onJob} />}
    </Card>
  );
}

function AddDiskDialog({ v, disks, onClose, onJob }: { v: Volume; disks: Disk[]; onClose: () => void; onJob: (id: string) => void }) {
  const free = disks.filter((d) => d.selectable);
  const growable = ["raid1", "raid5", "raid6"].includes(v.level);
  const modes = [
    v.status === "degraded" && { value: "replace", label: "Replace failed disk", text: "Rebuild the missing data onto this disk." },
    growable &&
      v.status !== "degraded" && {
        value: "grow",
        label: v.level === "raid1" ? "Add mirror" : "Expand capacity",
        text:
          v.level === "raid1"
            ? "Adds another copy of the data (more redundancy, same capacity)."
            : "Reshapes the array onto one more disk. This can take many hours; afterwards use 'Expand filesystem'.",
      },
    v.level !== "raid0" && { value: "spare", label: "Hot spare", text: "Stands by and automatically replaces a failing disk." },
  ].filter(Boolean) as { value: string; label: string; text: string }[];
  const [mode, setMode] = useState(modes[0]?.value ?? "spare");
  const [disk, setDisk] = useState<string | null>(null);
  const add = useAction(() => api.post<Job>(`/volumes/${v.name}/disks`, { disk, mode }), {
    onSuccess: (j) => {
      onClose();
      onJob(j.id);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add disk to ${v.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!disk || !modes.length} loading={add.isPending} onClick={() => add.mutate()}>
            Add disk
          </Button>
        </>
      }
    >
      {!modes.length ? (
        <Callout tone="info">RAID 0 volumes cannot be extended with additional disks.</Callout>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={cx(
                  "rounded-xl p-3 text-left ring-1 transition",
                  mode === m.value ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:ring-zinc-300 dark:ring-white/10",
                )}
              >
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{m.text}</div>
              </button>
            ))}
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium">Select disk</div>
            {free.length === 0 ? (
              <Callout tone="warning">No unused disks available.</Callout>
            ) : (
              <div className="space-y-2">
                {free.map((d) => (
                  <DiskRow key={d.name} d={d} selected={disk === d.name} onClick={() => setDisk(d.name)} />
                ))}
              </div>
            )}
          </div>
          {disk && <Callout tone="warning">All data on {disk} will be erased.</Callout>}
        </div>
      )}
    </Modal>
  );
}

/* ====================================================================== wizard */

function DiskRow({ d, selected, onClick, disabled }: { d: Disk; selected: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition",
        disabled
          ? "cursor-not-allowed opacity-50 ring-zinc-200 dark:ring-white/5"
          : selected
            ? "bg-brand-50/70 ring-2 ring-brand-500 dark:bg-brand-500/10"
            : "ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 dark:ring-white/10 dark:hover:bg-white/[0.03]",
      )}
    >
      <div
        className={cx(
          "flex size-5 shrink-0 items-center justify-center rounded-md ring-1 transition",
          selected ? "bg-brand-600 text-white ring-brand-600" : "ring-zinc-300 dark:ring-white/20",
        )}
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </div>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/5">
        <DiskIcon kind={d.kind} className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-semibold">{d.name}</span>
          <Badge>{kindLabel[d.kind]}</Badge>
          {d.status === "has_data" && <Badge tone="amber">Has data</Badge>}
          {d.health === "failing" && <Badge tone="red">SMART failing</Badge>}
        </div>
        <div className="truncate text-xs text-zinc-500">
          {d.model}
          {d.serial && ` · ${d.serial}`}
          {disabled && ` · ${d.status_detail}`}
        </div>
      </div>
      <div className="tabular text-sm font-semibold">{bytes(d.size)}</div>
    </button>
  );
}

function Dots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-1.5 w-3 rounded-full", i <= n ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />
      ))}
    </span>
  );
}

const STEPS = ["Disks", "RAID type", "Volume", "Confirm"];

function CreateWizard({
  disks,
  existing,
  onClose,
  onJob,
}: {
  disks: Disk[];
  existing: string[];
  onClose: () => void;
  onJob: (id: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [spares, setSpares] = useState(0);
  const [level, setLevel] = useState<string | null>(null);
  const [fs, setFs] = useState<"ext4" | "xfs">("ext4");
  const defaultName = useMemo(() => {
    for (let i = 1; ; i++) if (!existing.includes(`volume${i}`)) return `volume${i}`;
  }, [existing]);
  const [name, setName] = useState(defaultName);
  const [confirm, setConfirm] = useState("");

  const selectable = disks.filter((d) => d.selectable);
  const unusable = disks.filter((d) => !d.selectable);
  const byName = Object.fromEntries(disks.map((d) => [d.name, d]));
  // spares are the largest selected disks (a spare must be >= the smallest member)
  const ordered = [...sel].sort((a, b) => byName[a].size - byName[b].size);
  const dataDisks = ordered.slice(0, ordered.length - spares);
  const spareDisks = ordered.slice(ordered.length - spares);

  const opts = useQuery({
    queryKey: ["raid-options", ordered.join(","), spares],
    queryFn: () => api.post<RaidOption[]>("/volumes/options", { disks: ordered, spares }),
    enabled: sel.length > 0,
  });
  const chosen = opts.data?.find((o) => o.id === level);

  useEffect(() => {
    if (!opts.data) return;
    if (!level || !opts.data.find((o) => o.id === level)?.available) {
      setLevel(opts.data.find((o) => o.recommended)?.id ?? opts.data.find((o) => o.available)?.id ?? null);
    }
  }, [opts.data]); // eslint-disable-line

  const maxSpares = useMemo(() => {
    if (!level || !["raid1", "raid5", "raid6", "raid10"].includes(level)) return 0;
    const min = { raid1: 2, raid5: 3, raid6: 4, raid10: 4 }[level]!;
    return Math.max(0, sel.length - min);
  }, [level, sel.length]);
  useEffect(() => {
    if (spares > maxSpares) setSpares(maxSpares);
  }, [maxSpares]); // eslint-disable-line

  const nameErr = !/^[a-z][a-z0-9_-]{0,23}$/.test(name)
    ? "Use lowercase letters, digits, - and _ (start with a letter, max 24)"
    : existing.includes(name)
      ? "A volume with this name exists"
      : null;

  const create = useAction(() => api.post<Job>("/volumes", { name, level, disks: dataDisks, spares: spareDisks, fs }), {
    invalidate: ["volumes", "disks"],
    onSuccess: (j) => onJob(j.id),
  });

  const canNext = [sel.length > 0, !!chosen?.available, !nameErr, confirm === name][step];
  const toggle = (n: string) => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Create volume"
      description="Build a storage volume from one or more disks"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {step > 0 && (
              <Button variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {step < 3 ? (
              <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="danger" disabled={!canNext} loading={create.isPending} onClick={() => create.mutate()}>
                Erase disks & create
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* stepper */}
      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
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
            <span className={cx("hidden text-[13px] font-medium sm:inline", i === step ? "text-zinc-900 dark:text-white" : "text-zinc-500")}>{s}</span>
            {i < STEPS.length - 1 && <div className={cx("h-px flex-1", i < step ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Select the disks for the new volume. <span className="font-medium">{sel.length}</span> selected
              {sel.length > 0 && ` · ${bytes(sel.reduce((a, n) => a + byName[n].size, 0))} raw`}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSel(sel.length === selectable.length ? [] : selectable.map((d) => d.name))}
            >
              {sel.length === selectable.length ? "Clear" : "Select all"}
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {selectable.map((d) => (
              <DiskRow key={d.name} d={d} selected={sel.includes(d.name)} onClick={() => toggle(d.name)} />
            ))}
          </div>
          {unusable.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-[13px] text-zinc-500">{unusable.length} disk(s) in use and not selectable</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {unusable.map((d) => (
                  <DiskRow key={d.name} d={d} selected={false} disabled />
                ))}
              </div>
            </details>
          )}
          {sel.some((n) => byName[n].kind === "usb") && (
            <Callout tone="info">
              USB disks work, but can disconnect under load. For RAID, use a powered USB hub or SATA/NVMe where possible.
            </Callout>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Options for <b>{dataDisks.length}</b> data disk{dataDisks.length > 1 ? "s" : ""}
            {spares > 0 && (
              <>
                {" "}
                + <b>{spares}</b> hot spare{spares > 1 ? "s" : ""}
              </>
            )}
            . Unavailable layouts need more disks.
          </p>
          {!opts.data ? (
            <PageLoader />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {opts.data.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!o.available}
                  onClick={() => setLevel(o.id)}
                  className={cx(
                    "relative rounded-2xl p-4 text-left ring-1 transition",
                    !o.available && "cursor-not-allowed opacity-45 ring-zinc-200 dark:ring-white/5",
                    o.available && level === o.id && "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10",
                    o.available && level !== o.id && "ring-zinc-200 hover:ring-zinc-300 dark:ring-white/10 dark:hover:ring-white/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{o.label}</span>
                      {o.recommended && (
                        <Badge tone="violet">
                          <Sparkles className="size-3" /> Recommended
                        </Badge>
                      )}
                    </div>
                    {o.available && <span className="tabular text-sm font-semibold">{bytes(o.usable_bytes)}</span>}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{o.description}</p>
                  {o.available ? (
                    <>
                      <div className="mt-3">
                        <CapacityBar
                          parts={[
                            { value: o.usable_bytes, className: "bg-gradient-to-r from-brand-500 to-violet-500", label: "Usable" },
                            {
                              value: Math.max(0, o.raw_bytes - o.usable_bytes),
                              className: "bg-zinc-300 dark:bg-white/20",
                              label: "Redundancy / spare / unused",
                            },
                          ]}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                          <ShieldCheck className={cx("size-3.5", o.fault_tolerance ? "text-emerald-500" : "text-rose-500")} />
                          {o.fault_tolerance ? `Survives ${o.fault_tolerance} disk failure${o.fault_tolerance > 1 ? "s" : ""}` : "No protection"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Zap className="size-3.5" /> Read <Dots n={o.read_perf} />
                        </span>
                        <span className="flex items-center gap-1.5">
                          Write <Dots n={o.write_perf} />
                        </span>
                      </div>
                      {o.warnings.map((w) => (
                        <div key={w} className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                          ⚠ {w.replace(/(\d{6,}) bytes/, (_m, n) => bytes(Number(n)))}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="mt-3 text-xs font-medium text-zinc-500">{o.reason}</div>
                  )}
                </button>
              ))}
            </div>
          )}
          {maxSpares > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-sm font-medium">Hot spares</div>
                <div className="text-xs text-zinc-500">Standby disks that automatically take over when a disk fails.</div>
              </div>
              <Segmented
                value={String(spares)}
                onChange={(v) => setSpares(Number(v))}
                options={Array.from({ length: Math.min(maxSpares, 4) + 1 }, (_, i) => ({ value: String(i), label: String(i) }))}
              />
            </Card>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-5">
            <Field label="Volume name" error={nameErr} hint={`Mounted at /srv/nas/${name || "…"}`}>
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} maxLength={24} />
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Filesystem</div>
              <div className="grid gap-2">
                {[
                  { id: "ext4", title: "ext4", text: "The proven Linux default. Robust, can be grown and shrunk, excellent tooling. Recommended." },
                  { id: "xfs", title: "XFS", text: "High performance with large files and big volumes. Can be grown, but not shrunk." },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFs(f.id as "ext4" | "xfs")}
                    className={cx(
                      "rounded-xl p-3.5 text-left ring-1 transition",
                      fs === f.id ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:ring-zinc-300 dark:ring-white/10",
                    )}
                  >
                    <div className="text-sm font-semibold">{f.title}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{f.text}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Summary name={name} level={chosen} fs={fs} data={dataDisks} spares={spareDisks} byName={byName} />
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Callout tone="danger" title="All data on these disks will be erased">
              <ul className="mt-1 list-disc pl-4">
                {[...dataDisks, ...spareDisks].map((n) => (
                  <li key={n}>
                    <span className="font-mono">{n}</span> — {byName[n].model} ({bytes(byName[n].size)})
                  </li>
                ))}
              </ul>
            </Callout>
            <Field
              label={
                <>
                  Type <span className="font-mono font-semibold">{name}</span> to confirm
                </>
              }
            >
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </Field>
            {level !== "single" && level !== "raid0" && (
              <p className="text-xs text-zinc-500">
                The volume is usable immediately. The RAID synchronises in the background, which can take several hours on large disks.
              </p>
            )}
          </div>
          <Summary name={name} level={chosen} fs={fs} data={dataDisks} spares={spareDisks} byName={byName} />
        </div>
      )}
    </Modal>
  );
}

function Summary({
  name,
  level,
  fs,
  data,
  spares,
  byName,
}: {
  name: string;
  level?: RaidOption;
  fs: string;
  data: string[];
  spares: string[];
  byName: Record<string, Disk>;
}) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-5 ring-1 ring-zinc-200/70 dark:bg-white/[0.03] dark:ring-white/5">
      <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Summary</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{level ? bytes(level.usable_bytes) : "—"}</div>
      <div className="text-sm text-zinc-500">usable capacity</div>
      <dl className="mt-5 space-y-2 text-[13px]">
        {[
          ["Name", name],
          ["Layout", level?.label],
          ["Filesystem", fs.toUpperCase()],
          ["Protection", level ? (level.fault_tolerance ? `${level.fault_tolerance} disk failure(s)` : "None") : "—"],
          ["Data disks", data.join(", ")],
          ["Hot spares", spares.length ? spares.join(", ") : "None"],
          ["Raw capacity", bytes([...data, ...spares].reduce((a, n) => a + byName[n].size, 0))],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
