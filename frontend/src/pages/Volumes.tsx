import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Database, Expand, Layers, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, dateTime, levelLabel, pct } from "../lib/format";
import { useAction } from "../lib/hooks";
import { Link } from "../lib/router";
import type { Job, Volume, VolumeSources } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { DiskRow, MemberList, NAME_HINT, NAME_RE, Stat, StatusBadge, SyncProgress, Tick, statusTone } from "../components/storage";
import { Button, Callout, Card, ConfirmDialog, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, PageLoader, Progress, Segmented, usageTone } from "../components/ui";

/** Kept for the dashboard. */
export function VolumeStatusBadge({ v }: { v: Pick<Volume, "status"> }) {
  return <StatusBadge status={v.status} />;
}

export default function VolumesPage() {
  const vols = useQuery({ queryKey: ["volumes"], queryFn: () => api.get<Volume[]>("/volumes"), refetchInterval: 4000 });
  const sources = useQuery({ queryKey: ["volume-sources"], queryFn: () => api.get<VolumeSources>("/volumes/sources"), refetchInterval: 15000 });
  const [create, setCreate] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  if (!vols.data || !sources.data) return <PageLoader />;
  const nSources = sources.data.arrays.length + sources.data.disks.length;
  const button = (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate(true)} disabled={!nSources}>
      Create volume
    </Button>
  );

  return (
    <>
      <PageHeader title="Volumes" description="Storage on a RAID array or a single disk." actions={button} />
      {vols.data.length === 0 ? (
        <Card>
          <Empty
            icon={<Database className="size-6" />}
            title="No volumes yet"
            text={
              nSources
                ? "Create one on a RAID array or a single disk."
                : "No unused RAID arrays or disks."
            }
            action={nSources > 0 && button}
          />
        </Card>
      ) : (
        <div className="grid gap-5 2xl:grid-cols-2">
          {vols.data.map((v) => (
            <VolumeCard key={v.name} v={v} onJob={setJob} />
          ))}
        </div>
      )}
      {create && (
        <CreateVolumeDialog
          sources={sources.data}
          existing={vols.data.map((v) => v.name)}
          onClose={() => setCreate(false)}
          onJob={(id) => {
            setCreate(false);
            setJob(id);
          }}
        />
      )}
      <JobDialog jobId={job} onClose={() => setJob(null)} />
    </>
  );
}

/* ====================================================================== card */

function VolumeCard({ v, onJob }: { v: Volume; onJob: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = pct(v.used, v.size);
  const del = useAction(() => api.del<Job>(`/volumes/${v.name}`), {
    invalidate: ["volumes", "volume-sources"],
    onSuccess: (j) => {
      setConfirmDelete(false);
      onJob(j.id);
    },
  });
  const expand = useAction(() => api.post<Job>(`/volumes/${v.name}/expand`), { onSuccess: (j) => onJob(j.id) });

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
              <StatusBadge status={v.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-zinc-500">
              {v.array ? (
                <Link to="/raid" className="font-medium text-zinc-700 hover:text-brand-600 dark:text-zinc-300">
                  RAID {v.array} ({levelLabel[v.level] ?? v.level})
                </Link>
              ) : (
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Disk {v.disk ?? "?"}</span>
              )}
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

      {v.status_detail && statusTone(v.status) !== "info" && (
        <div className="px-5 pb-3">
          <Callout tone={statusTone(v.status)}>{v.status_detail}</Callout>
        </div>
      )}
      {v.sync && v.sync.sync_action !== "idle" && (
        <div className="px-5 pb-4">
          <SyncProgress sync={v.sync} />
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
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Free" value={bytes(v.free)} />
          <Stat label="Disks" value={v.members.filter((m) => m.state !== "spare").length} />
          <Stat label="Survives" value={v.fault_tolerance ? `${v.fault_tolerance} failure${v.fault_tolerance > 1 ? "s" : ""}` : "No failures"} />
        </div>
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-white/5 dark:bg-white/[0.015]">
        <div className="mb-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Disks</div>
        <MemberList members={v.members} />
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
            All data on <b>{v.name}</b> will be <b>permanently erased</b>.{" "}
            {v.array ? <>RAID {v.array} is kept and can hold a new volume.</> : <>Disk {v.disk} is wiped.</>}
            {v.shares.length > 0 && (
              <Callout tone="warning" className="mt-3">
                Delete its shared folders first: {v.shares.join(", ")}
              </Callout>
            )}
          </>
        }
      />
    </Card>
  );
}

/* ====================================================================== create */

function CreateVolumeDialog({
  sources,
  existing,
  onClose,
  onJob,
}: {
  sources: VolumeSources;
  existing: string[];
  onClose: () => void;
  onJob: (id: string) => void;
}) {
  type Src = { kind: "array" | "disk"; name: string };
  const first: Src | null = sources.arrays[0]
    ? { kind: "array", name: sources.arrays[0].name }
    : sources.disks[0]
      ? { kind: "disk", name: sources.disks[0].name }
      : null;
  const [src, setSrc] = useState<Src | null>(first);
  // first free name: volume1, volume2, ...
  const suggested = useMemo(() => {
    for (let i = 1; ; i++) if (!existing.includes(`volume${i}`)) return `volume${i}`;
  }, [existing]);
  const [name, setName] = useState(suggested);
  const [fs, setFs] = useState<"ext4" | "xfs">("ext4");
  const [agree, setAgree] = useState(false);
  useEffect(() => setAgree(false), [src]);
  const erasesDisk = src?.kind === "disk";

  const nameErr = !NAME_RE.test(name) ? NAME_HINT : existing.includes(name) ? "A volume with this name exists" : null;
  const create = useAction(
    () => api.post<Job>("/volumes", { name, fs, array: src?.kind === "array" ? src.name : null, disk: src?.kind === "disk" ? src.name : null }),
    { invalidate: ["volumes", "volume-sources", "raid", "disks"], onSuccess: (j) => onJob(j.id) },
  );
  const ok = !!src && !nameErr && (!erasesDisk || agree);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Create volume"
      description="Format a RAID array or a single disk and mount it"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={erasesDisk ? "danger" : "primary"} disabled={!ok} loading={create.isPending} onClick={() => create.mutate()}>
            {erasesDisk ? "Erase disk & create" : "Create volume"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <div>
          <div className="mb-2 text-[13px] font-medium">Create the volume on</div>
          <div className="space-y-2">
            {sources.arrays.map((a) => (
              <button
                key={a.name}
                type="button"
                onClick={() => setSrc({ kind: "array", name: a.name })}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl p-2.5 text-left ring-1 transition sm:p-3",
                  src?.kind === "array" && src.name === a.name
                    ? "bg-brand-50/70 ring-2 ring-brand-500 dark:bg-brand-500/10"
                    : "ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 dark:ring-white/10 dark:hover:bg-white/[0.03]",
                )}
              >
                <Tick radio selected={src?.kind === "array" && src.name === a.name} />
                <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 sm:flex dark:bg-brand-500/10 dark:text-brand-300">
                  <Layers className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">RAID {a.name}</div>
                  <div className="text-xs text-zinc-500">{levelLabel[a.level] ?? a.level}</div>
                </div>
                <div className="tabular shrink-0 text-sm font-semibold">{bytes(a.size)}</div>
              </button>
            ))}
            {sources.disks.map((d) => (
              <DiskRow key={d.name} d={d} radio selected={src?.kind === "disk" && src.name === d.name} onClick={() => setSrc({ kind: "disk", name: d.name })} />
            ))}
            {!sources.arrays.length && (
              <p className="text-xs text-zinc-500">
                For protection against disk failure,{" "}
                <Link to="/raid" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  create a RAID array
                </Link>{" "}
                first.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Volume name" error={nameErr} hint={`Mounted at /srv/nas/${name || "…"}`}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              maxLength={24}
            />
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Filesystem</div>
            <Segmented
              value={fs}
              onChange={setFs}
              options={[
                { value: "ext4", label: "ext4" },
                { value: "xfs", label: "XFS" },
              ]}
            />
            <div className="mt-1.5 hidden text-xs text-zinc-500 sm:block">{fs === "ext4" ? "Recommended Linux default" : "For very large files"}</div>
          </div>
        </div>

        {erasesDisk && src && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20">
            <input type="checkbox" className="mt-0.5 size-4 accent-rose-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              I understand that <b>all data on {src.name} will be erased</b>. A single disk has no protection against disk failure.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
