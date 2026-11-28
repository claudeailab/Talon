import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Expand,
  FolderTree,
  Layers,
  MoreHorizontal,
  Plus,
  Scaling,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, dateTime, levelLabel, pct } from "../lib/format";
import { useAction } from "../lib/hooks";
import { Link, navigate } from "../lib/router";
import type { Job, Volume, VolumeSources } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { FormHint } from "../components/rows";
import {
  DiskRow,
  Detail,
  Details,
  ITEM_CARD, ITEM_LIST, ITEM_MENU, ITEM_WRAP,
  ITEM_ROW,
  ItemTitle,
  MemberChips,
  NAME_HINT,
  NAME_RE,
  Stat,
  StatusBadge,
  SyncProgress,
  Tick,
  statusTone,
} from "../components/storage";
import {
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

/** Kept for the dashboard. */
export function VolumeStatusBadge({ v }: { v: Pick<Volume, "status"> }) {
  return <StatusBadge status={v.status} />;
}

export default function VolumesPage() {
  const vols = useQuery({
    queryKey: ["volumes"],
    queryFn: () => api.get<Volume[]>("/volumes"),
    refetchInterval: 4000,
  });
  const sources = useQuery({
    queryKey: ["volume-sources"],
    queryFn: () => api.get<VolumeSources>("/volumes/sources"),
    refetchInterval: 15000,
  });
  // the RAID page links here with ?create=1
  const [create, setCreate] = useState(() => new URLSearchParams(location.search).has("create"));
  const [job, setJob] = useState<string | null>(null);
  useEffect(() => {
    if (create && location.search) history.replaceState(null, "", location.pathname);
  }, [create]);
  if (!vols.data || !sources.data) return <PageLoader />;
  const nSources = sources.data.arrays.length + sources.data.disks.length;
  const button = (
    <Button
      variant="primary"
      icon={<Plus className="size-4" />}
      onClick={() => setCreate(true)}
      disabled={!nSources}
    >
      Create volume
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Volumes"
        description="Storage on a RAID array or a single disk"
        actions={button}
      />
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
        <div className={ITEM_LIST}>
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
  const expand = useAction(() => api.post<Job>(`/volumes/${v.name}/expand`), {
    onSuccess: (j) => onJob(j.id),
  });
  const [resize, setResize] = useState(false);

  return (
    <Card className={ITEM_CARD}>
      <div className={ITEM_WRAP}>
      <div className={ITEM_ROW}>
        <ItemTitle icon={<Database />} name={v.name} badge={<StatusBadge status={v.status} />} note={v.created ? `Created ${dateTime(v.created)}` : undefined}>
          {v.array ? (
            <Link to="/raid" className="font-medium whitespace-nowrap text-zinc-700 hover:text-brand-600 dark:text-zinc-300">
              {levelLabel[v.level] ?? v.level} on {v.array}
            </Link>
          ) : (
            <span className="font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-300">Disk {v.disk ?? "?"}</span>
          )}
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{v.fs.toUpperCase()}</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs break-all">{v.mountpoint}</span>
        </ItemTitle>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
              <span>
                <span className="tabular font-semibold">{bytes(v.used)}</span>
                <span className="text-zinc-500"> of {bytes(v.size)} used</span>
              </span>
              <span className="tabular text-zinc-500">{p.toFixed(1)}%</span>
            </div>
            <Progress value={p} tone={usageTone(p)} className="h-1.5" />
          </div>
          {v.sync && v.sync.sync_action !== "idle" && <SyncProgress sync={v.sync} />}
          <Details>
            {v.members.length > 0 && (
              <Detail label="Disks">
                <MemberChips members={v.members} />
              </Detail>
            )}
            <Detail label="Shared folders">
              {v.shares.length ? <span className="font-medium text-zinc-700 dark:text-zinc-300">{v.shares.join(", ")}</span> : <span>None</span>}
            </Detail>
          </Details>
        </div>

        <div className="grid w-60 max-w-full grid-cols-2 gap-4">
          <Stat label="Free" value={bytes(v.free)} />
          <Stat label="Survives" value={v.fault_tolerance ? `${v.fault_tolerance} failure${v.fault_tolerance > 1 ? "s" : ""}` : "No failures"} />
        </div>
      </div>

      <div className={ITEM_MENU}>
        <Menu
          trigger={
            <IconButton label="Volume actions">
              <MoreHorizontal className="size-5" />
            </IconButton>
          }
        >
          <MenuItem icon={<FolderTree />} disabled={!v.mounted} onClick={() => navigate(`/browser?volume=${encodeURIComponent(v.name)}`)}>
            Browse files
          </MenuItem>
          {v.resizable && (
            <MenuItem icon={<Scaling />} disabled={!v.mounted} onClick={() => setResize(true)}>
              Change size
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
      </div>

      {v.status_detail && statusTone(v.status) !== "info" && (
        <div className="px-4 pb-4 sm:px-5">
          <Callout tone={statusTone(v.status)}>{v.status_detail}</Callout>
        </div>
      )}

      {resize && (
        <ResizeDialog
          v={v}
          onClose={() => setResize(false)}
          onJob={(id) => {
            setResize(false);
            onJob(id);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        danger
        title={`Delete volume ${v.name}?`}
        confirmText="Delete volume"
        acknowledge={
          <>
            I understand that everything on <b>{v.name}</b> is erased
          </>
        }
        message={
          <>
            All data on <b>{v.name}</b> will be <b>permanently erased</b>.{" "}
            {v.array ? (
              <>RAID {v.array} is kept; the space becomes free for other volumes.</>
            ) : (
              <>Disk {v.disk} is wiped.</>
            )}
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
    for (let i = 1; ; i++)
      if (!existing.includes(`volume${i}`)) return `volume${i}`;
  }, [existing]);
  const [name, setName] = useState(suggested);
  const [fs, setFs] = useState<"ext4" | "xfs">("ext4");
  const [agree, setAgree] = useState(false);
  useEffect(() => setAgree(false), [src]);
  const erasesDisk = src?.kind === "disk";
  const arr = src?.kind === "array" ? sources.arrays.find((a) => a.name === src.name) : undefined;
  // on a RAID array: the size, all the free space unless chosen otherwise
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => setSize(null), [src?.name]);
  const sizeBytes = arr ? (size ?? arr.free) : null;

  const nameErr = !NAME_RE.test(name)
    ? NAME_HINT
    : existing.includes(name)
      ? "A volume with this name exists"
      : null;
  const create = useAction(
    () =>
      api.post<Job>("/volumes", {
        name,
        fs,
        array: src?.kind === "array" ? src.name : null,
        disk: src?.kind === "disk" ? src.name : null,
        size: arr && size !== null && size < arr.free ? size : null,
      }),
    {
      invalidate: ["volumes", "volume-sources", "raid", "disks"],
      onSuccess: (j) => onJob(j.id),
    },
  );
  const [sizeErr, setSizeErr] = useState<string | null>(null);
  const ok = !!src && !nameErr && !sizeErr && (!erasesDisk || agree);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Create volume"
      description="On a RAID array, next to its other volumes, or on a single disk"
      footer={
        <>
          <FormHint text={sizeErr} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={erasesDisk ? "danger" : "primary"}
            disabled={!ok}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            {erasesDisk ? "Erase disk & create" : "Create volume"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <div>
          <div className="mb-2 text-[13px] font-medium">
            Create the volume on
          </div>
          {/* a long list of disks scrolls on its own, so the rest of the window stays in view */}
          <div className="-m-1 max-h-[17rem] space-y-2 overflow-y-auto p-1">
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
                <Tick
                  radio
                  selected={src?.kind === "array" && src.name === a.name}
                />
                <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 sm:flex dark:bg-brand-500/10 dark:text-brand-300">
                  <Layers className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">RAID {a.name}</div>
                  <div className="text-xs text-zinc-500">
                    {levelLabel[a.level] ?? a.level}
                    {a.volumes.length > 0 && ` · also holds ${a.volumes.join(", ")}`}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-sm font-semibold">{bytes(a.free)}</div>
                  <div className="text-[11px] text-zinc-500">{a.free < a.size ? `free of ${bytes(a.size)}` : "free"}</div>
                </div>
              </button>
            ))}
            {sources.disks.map((d) => (
              <DiskRow
                key={d.name}
                d={d}
                radio
                selected={src?.kind === "disk" && src.name === d.name}
                onClick={() => setSrc({ kind: "disk", name: d.name })}
              />
            ))}
            {!sources.arrays.length && (
              <p className="text-xs text-zinc-500">
                For protection against disk failure,{" "}
                <Link
                  to="/raid"
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  create a RAID array
                </Link>{" "}
                first.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field
            label="Volume name"
            error={nameErr}
            hint={`Mounted at /srv/nas/${name || "…"}`}
          >
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
            <div className="mt-1.5 hidden text-xs text-zinc-500 sm:block">
              {fs === "ext4"
                ? "Recommended Linux default"
                : "For very large files"}
            </div>
          </div>
        </div>

        {arr && sizeBytes !== null && (
          <SizePicker
            value={sizeBytes}
            min={Math.min(GB, arr.free)}
            max={arr.free}
            onChange={setSize}
            onError={setSizeErr}
            hint={
              sizeBytes < arr.free
                ? `${bytes(arr.free - sizeBytes)} stays free for other volumes. ${fs === "ext4" ? "The size can change later." : "XFS can grow later, not shrink."}`
                : `Uses all the free space. ${fs === "ext4" ? "It can shrink later to make room." : "XFS cannot shrink later; choose ext4 to keep that option."}`
            }
          />
        )}

        {erasesDisk && src && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-rose-600"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>
              I understand that <b>all data on {src.name} will be erased</b>. A
              single disk has no protection against disk failure.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

const GB = 2 ** 30;

/** A size between min and max: a slider and the number in GB. A typed number counts at
 *  once (no need to leave the field); one outside the range is reported with onError. */
function SizePicker({ value, min, max, onChange, onError, hint, label = "Size" }: { value: number; min: number; max: number; onChange: (b: number) => void; onError?: (msg: string | null) => void; hint?: string; label?: string }) {
  const [text, setText] = useState(String(Math.round(value / GB)));
  const parse = (t: string) => Number(t.trim().replace(",", "."));
  // the slider or "Use all" moved: show the new number (not while it matches what is typed)
  useEffect(() => {
    if (Math.round(parse(text)) !== Math.round(value / GB)) setText(String(Math.round(value / GB)));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = (t: string) => {
    setText(t);
    const n = parse(t);
    const b = Math.round(n * GB);
    if (!t.trim() || !Number.isFinite(n) || n <= 0) return onError?.(`Enter a size in GB`);
    if (b < min - GB / 2 || b > max + GB / 2) return onError?.(`Enter a size from ${bytes(min)} to ${bytes(max)}`);
    onError?.(null);
    onChange(Math.max(min, Math.min(max, b)));
  };
  const commit = () => {
    setText(String(Math.round(value / GB)));      // an unfinished number goes back to the size
    onError?.(null);
  };
  const slide = (b: number) => {
    onError?.(null);
    setText(String(Math.round(b / GB)));
    onChange(b);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-xs text-zinc-500">
          {bytes(min)} – {bytes(max)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={GB}
          value={value}
          onChange={(e) => slide(Math.min(max, Number(e.target.value)))}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-brand-600"
          aria-label={label}
        />
        <div className="flex w-32 shrink-0 items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-white focus-within:border-brand-500 dark:border-white/10 dark:bg-white/[0.04]">
          <input
            value={text}
            inputMode="decimal"
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="tabular min-w-0 flex-1 bg-transparent px-3 py-2 text-right text-sm outline-none"
            aria-label={`${label} in GB`}
          />
          <span className="flex items-center bg-zinc-50 px-2.5 text-xs text-zinc-500 dark:bg-white/5">GB</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-zinc-500">
        <span>{hint}</span>
        {value < max && (
          <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => slide(max)}>
            Use all ({bytes(max)})
          </button>
        )}
      </div>
    </div>
  );
}

/** Grow a volume into the RAID's free space, or shrink an ext4 volume to free some. */
function ResizeDialog({ v, onClose, onJob }: { v: Volume; onClose: () => void; onJob: (id: string) => void }) {
  const [size, setSize] = useState(v.lv_size);
  const [sizeErr, setSizeErr] = useState<string | null>(null);
  const grow = size > v.lv_size;
  const same = Math.abs(size - v.lv_size) < 8 * 2 ** 20;
  const resize = useAction(() => api.post<Job>(`/volumes/${v.name}/resize`, { size }), {
    invalidate: ["volumes", "volume-sources", "raid"],
    onSuccess: (j) => onJob(j.id),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change the size of ${v.name}`}
      description={`Now ${bytes(v.lv_size)} on RAID ${v.array}, ${bytes(v.used)} used`}
      footer={
        <>
          <FormHint text={sizeErr} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={same || !!sizeErr} loading={resize.isPending} onClick={() => resize.mutate()}>
            {grow ? "Grow" : "Shrink"} to {bytes(size)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SizePicker
          label="New size"
          value={size}
          min={v.min_size}
          max={v.max_size}
          onChange={setSize}
          onError={setSizeErr}
          hint={v.fs === "xfs" ? "XFS volumes can only grow." : "The smallest size leaves room for the files on it."}
        />
        {!same && !sizeErr &&
          (grow ? (
            <Callout tone="info">Grows while it stays in use; shared folders keep working.</Callout>
          ) : (
            <Callout tone="warning">
              Shrinking unmounts the volume for a moment: its shared folders are unavailable until it finishes. {bytes(v.lv_size - size)} becomes free for other
              volumes.
            </Callout>
          ))}
      </div>
    </Modal>
  );
}
