import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Layers, MoreHorizontal, Plus, ScanSearch, ShieldCheck, Sparkles, Trash2, Zap } from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, dateTime, levelLabel } from "../lib/format";
import { useAction } from "../lib/hooks";
import { Link } from "../lib/router";
import type { Disk, Job, Member, RaidArray, RaidOption } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { DiskRow, Dots, MemberList, NAME_HINT, NAME_RE, Stat, StatusBadge, Stepper, SyncProgress, statusTone } from "../components/storage";
import { Badge, Button, Callout, Card, ConfirmDialog, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, PageLoader, Segmented } from "../components/ui";

export default function RaidPage() {
  const arrays = useQuery({ queryKey: ["raid"], queryFn: () => api.get<RaidArray[]>("/raid"), refetchInterval: 4000 });
  const disks = useQuery({ queryKey: ["disks"], queryFn: () => api.get<Disk[]>("/disks"), refetchInterval: 15000 });
  const [wizard, setWizard] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  if (!arrays.data || !disks.data) return <PageLoader />;
  const free = disks.data.filter((d) => d.selectable);
  const create = (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWizard(true)} disabled={free.length < 2}>
      Create RAID
    </Button>
  );

  return (
    <>
      <PageHeader title="RAID" description="Combine disks into one array" actions={create} />
      {arrays.data.length === 0 ? (
        <Card>
          <Empty
            icon={<Layers className="size-6" />}
            title="No RAID arrays yet"
            text={
              free.length < 2
                ? "A RAID needs at least two unused disks."
                : `${free.length} disks available.`
            }
            action={free.length >= 2 && create}
          />
        </Card>
      ) : (
        <div className="grid gap-5">
          {arrays.data.map((a) => (
            <RaidCard key={a.name} a={a} disks={disks.data} onJob={setJob} />
          ))}
        </div>
      )}
      {wizard && (
        <CreateRaidWizard
          disks={disks.data}
          existing={arrays.data.map((a) => a.name)}
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

function RaidCard({ a, disks, onJob }: { a: RaidArray; disks: Disk[]; onJob: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addDisk, setAddDisk] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);
  const idle = a.sync?.sync_action === "idle";

  const del = useAction(() => api.del<Job>(`/raid/${a.name}`), {
    invalidate: ["raid"],
    onSuccess: (j) => {
      setConfirmDelete(false);
      onJob(j.id);
    },
  });
  const scrub = useAction((action: string) => api.post(`/raid/${a.name}/scrub`, { action }), {
    success: (_r, x) => (x === "check" ? "Data scrub started" : "Data scrub stopped"),
    invalidate: ["raid"],
  });
  const removeMember = useAction((part: string) => api.del<Job>(`/raid/${a.name}/members/${part}`), {
    onSuccess: (j) => {
      setRemove(null);
      onJob(j.id);
    },
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-md shadow-brand-500/20">
            <Layers className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{a.name}</h3>
              <StatusBadge status={a.status} />
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{levelLabel[a.level] ?? a.level}</div>
          </div>
        </div>
        <Menu
          trigger={
            <IconButton label="RAID actions">
              <MoreHorizontal className="size-5" />
            </IconButton>
          }
        >
          {a.status !== "missing" && (
            <MenuItem icon={<Plus />} onClick={() => setAddDisk(true)}>
              {a.status === "degraded" ? "Replace failed disk" : "Add disk"}
            </MenuItem>
          )}
          {a.level !== "raid0" && idle && (
            <MenuItem icon={<ScanSearch />} onClick={() => scrub.mutate("check")}>
              Run data scrub
            </MenuItem>
          )}
          {a.sync?.sync_action === "check" && (
            <MenuItem icon={<ScanSearch />} onClick={() => scrub.mutate("idle")}>
              Stop data scrub
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 />} danger disabled={a.volumes.length > 0} onClick={() => setConfirmDelete(true)}>
            {a.volumes.length ? `Delete RAID (delete its volume${a.volumes.length > 1 ? "s" : ""} first)` : "Delete RAID"}
          </MenuItem>
        </Menu>
      </div>

      {a.status_detail && statusTone(a.status) !== "info" && (
        <div className="px-5 pb-3">
          <Callout tone={statusTone(a.status)}>{a.status_detail}</Callout>
        </div>
      )}
      {a.sync && a.sync.sync_action !== "idle" && (
        <div className="px-5 pb-4">
          <SyncProgress sync={a.sync} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 px-5 pb-5">
        <Stat label="Capacity" value={bytes(a.size)} />
        <Stat label="Disks" value={a.members.filter((m) => m.state !== "spare").length} />
        <Stat label="Survives" value={a.fault_tolerance ? `${a.fault_tolerance} failure${a.fault_tolerance > 1 ? "s" : ""}` : "No failures"} />
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-white/5 dark:bg-white/[0.015]">
        <div className="mb-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Member disks</div>
        <MemberList members={a.members} onRemove={a.members.length > 1 ? setRemove : undefined} />
        <div className="mt-3 text-xs text-zinc-500">
          {a.volumes.length ? (
            <>
              {a.volumes.length > 1 ? "Volumes: " : "Volume: "}
              {a.volumes.map((v, i) => (
                <span key={v}>
                  {i > 0 && ", "}
                  <Link to="/volumes" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {v}
                  </Link>
                </span>
              ))}
              {a.free >= 2 ** 30 && (
                <>
                  {" · "}
                  {bytes(a.free)} free for more volumes.{" "}
                  <Link to="/volumes?create=1" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Create a volume
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              No volume yet.{" "}
              <Link to="/volumes?create=1" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Create a volume on this RAID
              </Link>
            </>
          )}
        </div>
        {a.created && <div className="mt-1 text-xs text-zinc-400">Created {dateTime(a.created)}</div>}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        danger
        title={`Delete RAID ${a.name}?`}
        confirmText="Delete RAID"
        typeToConfirm={a.name}
        message={
          <>
            The array is stopped and its disks ({a.members.map((m) => m.disk).join(", ")}) are <b>wiped</b>.
          </>
        }
      />
      <ConfirmDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        onConfirm={() => remove && removeMember.mutate(remove.part)}
        loading={removeMember.isPending}
        danger
        title={`Remove ${remove?.disk} from ${a.name}?`}
        confirmText="Remove disk"
        message={
          <>
            The disk is removed and wiped. If it is an active member, the RAID becomes <b>degraded</b> until you add a replacement disk.
          </>
        }
      />
      {addDisk && <AddDiskDialog a={a} disks={disks} onClose={() => setAddDisk(false)} onJob={onJob} />}
    </Card>
  );
}

function AddDiskDialog({ a, disks, onClose, onJob }: { a: RaidArray; disks: Disk[]; onClose: () => void; onJob: (id: string) => void }) {
  const free = disks.filter((d) => d.selectable);
  const growable = ["raid1", "raid5", "raid6"].includes(a.level);
  const modes = [
    a.status === "degraded" && { value: "replace", label: "Replace failed disk", text: "Rebuild the missing data onto this disk." },
    growable &&
      a.status !== "degraded" && {
        value: "grow",
        label: a.level === "raid1" ? "Add mirror" : "Expand capacity",
        text:
          a.level === "raid1"
            ? "Adds another copy of the data (more redundancy, same capacity)."
            : "Reshapes the array onto one more disk. This can take many hours; afterwards expand the volume's filesystem.",
      },
    a.level !== "raid0" && { value: "spare", label: "Hot spare", text: "Stands by and automatically replaces a failing disk." },
  ].filter(Boolean) as { value: string; label: string; text: string }[];
  const [mode, setMode] = useState(modes[0]?.value ?? "spare");
  const [disk, setDisk] = useState<string | null>(null);
  const add = useAction(() => api.post<Job>(`/raid/${a.name}/disks`, { disk, mode }), {
    onSuccess: (j) => {
      onClose();
      onJob(j.id);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add disk to ${a.name}`}
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
        <Callout tone="info">RAID 0 arrays cannot be extended with additional disks.</Callout>
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
                  <DiskRow key={d.name} d={d} radio selected={disk === d.name} onClick={() => setDisk(d.name)} />
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

const STEPS = ["Disks", "RAID level", "Confirm"];

function CreateRaidWizard({ disks, existing, onClose, onJob }: { disks: Disk[]; existing: string[]; onClose: () => void; onJob: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [spares, setSpares] = useState(0);
  const [level, setLevel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  const selectable = disks.filter((d) => d.selectable);
  const unusable = disks.filter((d) => !d.selectable);
  const byName = Object.fromEntries(disks.map((d) => [d.name, d]));
  // spares are the largest selected disks (a spare must be >= the smallest member)
  const ordered = [...sel].sort((x, y) => byName[x].size - byName[y].size);
  const dataDisks = ordered.slice(0, ordered.length - spares);
  const spareDisks = ordered.slice(ordered.length - spares);

  const opts = useQuery({
    queryKey: ["raid-options", ordered.join(","), spares],
    queryFn: () => api.post<RaidOption[]>("/raid/options", { disks: ordered, spares }),
    enabled: sel.length > 1,
  });
  const chosen = opts.data?.find((o) => o.id === level);
  // a warning every available level has (disks of different sizes) is shown once, above the list
  const avail = opts.data?.filter((o) => o.available) ?? [];
  const common = avail.length > 1 ? avail[0].warnings.filter((w) => avail.every((o) => o.warnings.includes(w))) : [];

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

  // suggested name = the chosen level (raid5), or raid5-2, raid5-3, ... if taken
  const suggested = useMemo(() => {
    const base = level ?? "raid";
    if (!existing.includes(base)) return base;
    for (let i = 2; ; i++) if (!existing.includes(`${base}-${i}`)) return `${base}-${i}`;
  }, [level, existing]);
  const [name, setName] = useState(suggested);
  const [nameEdited, setNameEdited] = useState(false);
  useEffect(() => {
    if (!nameEdited) setName(suggested);
  }, [suggested, nameEdited]);

  const nameErr = !NAME_RE.test(name) ? NAME_HINT : existing.includes(name) ? "A RAID with this name exists" : null;
  const create = useAction(() => api.post<Job>("/raid", { name, level, disks: dataDisks, spares: spareDisks }), {
    invalidate: ["raid", "disks"],
    onSuccess: (j) => onJob(j.id),
  });
  const canNext = [sel.length > 1, !!chosen?.available, !nameErr && confirm === name][step];
  const toggle = (n: string) => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Create RAID"
      description="Combine two or more disks into one protected array"
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
            {step < 2 ? (
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
      <Stepper steps={STEPS} step={step} />

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Select at least two disks. <span className="font-medium">{sel.length}</span> selected
              {sel.length > 0 && ` · ${bytes(sel.reduce((x, n) => x + byName[n].size, 0))} raw`}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setSel(sel.length === selectable.length ? [] : selectable.map((d) => d.name))}>
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
            <Callout tone="info">USB disks work, but can disconnect under load. For RAID, use a powered USB hub or SATA/NVMe where possible.</Callout>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Options for <b>{dataDisks.length}</b> data disks
            {spares > 0 && (
              <>
                {" "}
                + <b>{spares}</b> hot spare{spares > 1 ? "s" : ""}
              </>
            )}
            . Unavailable levels need more disks.
          </p>
          {!opts.data ? (
            <PageLoader />
          ) : (
            <>
              {common.length > 0 && (
                <Callout tone="warning">
                  {common.map((w) => (
                    <div key={w}>{fmtWarning(w)}</div>
                  ))}
                </Callout>
              )}
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
                {opts.data.map((o) => (
                  <LevelRow key={o.id} o={o} selected={level === o.id} hide={common} onClick={() => setLevel(o.id)} />
                ))}
              </div>
            </>
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
          <div className="space-y-4">
            <Field label="RAID name" error={nameErr}>
              <Input
                value={name}
                onChange={(e) => {
                  setNameEdited(true);
                  setName(e.target.value.toLowerCase());
                }}
                maxLength={24}
              />
            </Field>
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
            {level !== "raid0" && <p className="text-xs text-zinc-500">The RAID synchronises in the background, which can take several hours on large disks.</p>}
          </div>
          <div className="rounded-2xl bg-zinc-50 p-5 ring-1 ring-zinc-200/70 dark:bg-white/[0.03] dark:ring-white/5">
            <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Summary</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">{chosen ? bytes(chosen.usable_bytes) : "—"}</div>
            <div className="text-sm text-zinc-500">usable capacity</div>
            <dl className="mt-5 space-y-2 text-[13px]">
              {[
                ["Name", name],
                ["Level", chosen?.label],
                ["Protection", chosen ? (chosen.fault_tolerance ? `${chosen.fault_tolerance} disk failure(s)` : "None") : "—"],
                ["Data disks", dataDisks.join(", ")],
                ["Hot spares", spareDisks.length ? spareDisks.join(", ") : "None"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </Modal>
  );
}

const fmtWarning = (w: string) => w.replace(/(\d{6,}) bytes/, (_m, n) => bytes(Number(n)));

function LevelRow({ o, selected, hide, onClick }: { o: RaidOption; selected: boolean; hide: string[]; onClick: () => void }) {
  const warnings = o.warnings.filter((w) => !hide.includes(w) && !(o.fault_tolerance === 0 && /redundancy/i.test(w)));
  return (
    <button
      type="button"
      disabled={!o.available}
      onClick={onClick}
      className={cx(
        "flex w-full items-start gap-3 px-4 py-2.5 text-left transition",
        !o.available && "cursor-not-allowed opacity-50",
        o.available && selected && "bg-brand-50/70 dark:bg-brand-500/10",
        o.available && !selected && "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
      )}
    >
      <span
        className={cx(
          "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full ring-1",
          selected ? "bg-brand-600 ring-brand-600" : "ring-zinc-300 dark:ring-white/20",
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{o.label}</span>
          {o.recommended && (
            <Badge tone="violet">
              <Sparkles className="size-3" /> Recommended
            </Badge>
          )}
        </span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{o.description}</span>
        {o.available ? (
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className={cx("size-3.5", o.fault_tolerance ? "text-emerald-500" : "text-rose-500")} />
              {o.fault_tolerance ? `Survives ${o.fault_tolerance} disk failure${o.fault_tolerance > 1 ? "s" : ""}` : "No protection: one failed disk loses everything"}
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="size-3.5" /> Read <Dots n={o.read_perf} />
            </span>
            <span className="flex items-center gap-1.5">
              Write <Dots n={o.write_perf} />
            </span>
          </span>
        ) : (
          <span className="mt-0.5 block text-xs font-medium text-zinc-500">{o.reason}</span>
        )}
        {warnings.map((w) => (
          <span key={w} className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
            ⚠ {fmtWarning(w)}
          </span>
        ))}
      </span>
      {o.available && (
        <span className="shrink-0 text-right">
          <span className="tabular block text-sm font-semibold">{bytes(o.usable_bytes)}</span>
          <span className="block text-[11px] text-zinc-500">usable</span>
        </span>
      )}
    </button>
  );
}
