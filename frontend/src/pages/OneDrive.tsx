import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  Square,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { CloudTask, OneDriveStatus, Schedule, Volume } from "../lib/types";
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
  Select,
  Switch,
  useToast,
} from "../components/ui";

const DIR: Record<
  CloudTask["direction"],
  {
    label: string;
    text: string;
    tone: "blue" | "violet" | "amber";
    short: string;
  }
> = {
  pull: {
    label: "Backup from OneDrive",
    text: "Copies OneDrive files to the NAS",
    tone: "blue",
    short: "OneDrive → NAS",
  },
  push: {
    label: "Backup to OneDrive",
    text: "Copies NAS files to OneDrive",
    tone: "violet",
    short: "NAS → OneDrive",
  },
  bisync: {
    label: "Two-way sync",
    text: "Changes go both ways",
    tone: "amber",
    short: "Two-way",
  },
};

const SCHEDULES: { value: string; label: string }[] = [
  { value: "manual", label: "Manually" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
];

function scheduleLabel(s: Schedule) {
  if (s.kind === "manual") return "Manually";
  if (s.kind === "daily") return `Daily ${s.time}`;
  return (
    SCHEDULES.find((x) => x.value === String(s.minutes))?.label ??
    `Every ${s.minutes} min`
  );
}

const odPath = (p: string) => `OneDrive${p ? "/" + p : ""}`;
const nasPath = (t: Pick<CloudTask, "volume" | "folder">) =>
  `${t.volume}${t.folder ? "/" + t.folder : ""}`;

export default function OneDrivePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["onedrive"],
    queryFn: () => api.get<OneDriveStatus>("/onedrive"),
    refetchInterval: (x) =>
      x.state.data?.tasks.some((t) => t.running) ||
      x.state.data?.rclone.installing
        ? 2000
        : 10000,
  });
  const [edit, setEdit] = useState<CloudTask | "new" | null>(null);
  const [logOf, setLogOf] = useState<CloudTask | null>(null);
  const [del, setDel] = useState<CloudTask | null>(null);
  const [disc, setDisc] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.talon !== "onedrive") return;
      setWaiting(false);
      qc.invalidateQueries({ queryKey: ["onedrive"] });
      toast(e.data.ok ? "success" : "error", e.data.message);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [qc, toast]);

  const connect = useAction(
    () =>
      api.post<{ url: string }>("/onedrive/connect", {
        origin: location.origin,
      }),
    {
      onSuccess: (r) => {
        const w = 520,
          h = 680;
        const popup = window.open(
          r.url,
          "talon-onedrive",
          `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`,
        );
        if (!popup) location.href = r.url; // popup blocked: use this window
        setWaiting(true);
      },
    },
  );
  const disconnect = useAction(() => api.post("/onedrive/disconnect"), {
    success: "OneDrive disconnected",
    invalidate: ["onedrive"],
    onSuccess: () => setDisc(false),
  });
  const enable = useAction(() => api.post("/services/onedrive/enable"), {
    success: "OneDrive enabled",
    invalidate: ["onedrive", "services"],
  });
  const run = useAction((id: string) => api.post(`/onedrive/tasks/${id}/run`), {
    invalidate: ["onedrive"],
  });
  const stop = useAction(
    (id: string) => api.post(`/onedrive/tasks/${id}/stop`),
    { invalidate: ["onedrive"] },
  );
  const remove = useAction((id: string) => api.del(`/onedrive/tasks/${id}`), {
    success: "Task deleted",
    invalidate: ["onedrive"],
    onSuccess: () => setDel(null),
  });

  if (!q.data) return <PageLoader />;
  const d = q.data;
  const header = (
    <PageHeader
      title="OneDrive"
      description="Back up or sync folders with OneDrive."
      actions={
        d.enabled && d.connected ? (
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setEdit("new")}
          >
            New task
          </Button>
        ) : undefined
      }
    />
  );

  if (!d.enabled)
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<Power className="size-6" />}
            title="OneDrive is turned off"
            text="Turn on the OneDrive service to use it."
            action={
              <Button
                variant="primary"
                loading={enable.isPending}
                onClick={() => enable.mutate()}
              >
                Turn on
              </Button>
            }
          />
        </Card>
      </>
    );

  if (!d.entra.configured)
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<KeyRound className="size-6" />}
            title="Set up the Entra ID app first"
            text="OneDrive sign-in uses your own Microsoft Entra ID app."
            action={
              <Button
                variant="primary"
                onClick={() => navigate("/settings?tab=entra")}
              >
                Open Entra ID settings
              </Button>
            }
          />
        </Card>
      </>
    );

  return (
    <>
      {header}
      {d.rclone.installing && (
        <Callout tone="info" className="mb-5">
          Installing rclone, the transfer engine. This takes about a minute.
        </Callout>
      )}
      <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0364b8] to-[#28a8ea] text-white">
            <Cloud className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">
                Microsoft OneDrive
              </span>
              {d.connected ? (
                <Badge tone="green" dot>
                  Connected
                </Badge>
              ) : (
                <Badge dot>Not connected</Badge>
              )}
            </div>
            <div className="truncate text-[13px] text-zinc-500">
              {d.connected && d.account
                ? `${d.account.email} · ${d.account.drive_type === "personal" ? "Personal" : "Work or school"} · ${bytes(d.account.used)} of ${bytes(d.account.total)} used`
                : waiting
                  ? "Waiting for you to sign in with Microsoft…"
                  : "Sign in with Microsoft and allow access to your files."}
            </div>
          </div>
        </div>
        {d.connected ? (
          <Button
            variant="ghost"
            icon={<LogOut className="size-4" />}
            onClick={() => setDisc(true)}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={connect.isPending || waiting}
            onClick={() => connect.mutate()}
          >
            Sign in with Microsoft
          </Button>
        )}
      </Card>

      {d.connected &&
        (d.tasks.length === 0 ? (
          <Card>
            <Empty
              icon={<ArrowLeftRight className="size-6" />}
              title="No tasks yet"
              text="Create a task to back up or sync a folder."
              action={
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setEdit("new")}
                >
                  New task
                </Button>
              }
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                    <th className="px-5 py-3">Task</th>
                    <th className="hidden px-3 py-3 md:table-cell">
                      Direction
                    </th>
                    <th className="hidden px-3 py-3 lg:table-cell">Schedule</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Last run</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="w-24 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {d.tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="max-w-0 px-5 py-3.5 sm:max-w-none">
                        <div className="truncate font-medium">{t.name}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {t.direction === "push"
                            ? `${nasPath(t)} → ${odPath(t.remote)}`
                            : t.direction === "pull"
                              ? `${odPath(t.remote)} → ${nasPath(t)}`
                              : `${odPath(t.remote)} ⇄ ${nasPath(t)}`}
                        </div>
                      </td>
                      <td className="hidden px-3 md:table-cell">
                        <Badge tone={DIR[t.direction].tone}>
                          {DIR[t.direction].short}
                        </Badge>
                      </td>
                      <td className="hidden px-3 whitespace-nowrap text-zinc-600 lg:table-cell dark:text-zinc-400">
                        {scheduleLabel(t.schedule)}
                      </td>
                      <td className="hidden px-3 whitespace-nowrap text-zinc-600 sm:table-cell dark:text-zinc-400">
                        {t.last
                          ? `${ago(t.last.finished)} · ${t.last.files} file${t.last.files === 1 ? "" : "s"}`
                          : "Never"}
                      </td>
                      <td className="px-3">
                        <TaskStatus t={t} />
                      </td>
                      <td className="px-3">
                        <div className="flex items-center justify-end">
                          {t.running ? (
                            <IconButton
                              label="Stop"
                              onClick={() => stop.mutate(t.id)}
                            >
                              <Square className="size-4" />
                            </IconButton>
                          ) : (
                            <IconButton
                              label="Run now"
                              disabled={!d.rclone.installed}
                              onClick={() => run.mutate(t.id)}
                            >
                              <Play className="size-4" />
                            </IconButton>
                          )}
                          <Menu
                            trigger={
                              <IconButton label="Task actions">
                                <MoreHorizontal className="size-5" />
                              </IconButton>
                            }
                          >
                            <MenuItem
                              icon={<Pencil />}
                              disabled={!!t.running}
                              onClick={() => setEdit(t)}
                            >
                              Edit
                            </MenuItem>
                            <MenuItem
                              icon={<FileText />}
                              onClick={() => setLogOf(t)}
                            >
                              View log
                            </MenuItem>
                            <MenuItem
                              icon={<Trash2 />}
                              danger
                              onClick={() => setDel(t)}
                            >
                              Delete
                            </MenuItem>
                          </Menu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

      {edit && (
        <TaskDialog
          task={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
        />
      )}
      {logOf && <LogDialog task={logOf} onClose={() => setLogOf(null)} />}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.id)}
        loading={remove.isPending}
        danger
        title={`Delete task ${del?.name}?`}
        confirmText="Delete task"
        message="The task stops running. Files on the NAS and in OneDrive are not touched."
      />
      <ConfirmDialog
        open={disc}
        onClose={() => setDisc(false)}
        onConfirm={() => disconnect.mutate()}
        loading={disconnect.isPending}
        danger
        title="Disconnect OneDrive?"
        confirmText="Disconnect"
        message="Tasks stop running until you sign in again. No files are deleted."
      />
    </>
  );
}

function TaskStatus({ t }: { t: CloudTask }) {
  if (t.running) {
    const p = t.running.total_bytes
      ? (t.running.bytes / t.running.total_bytes) * 100
      : 0;
    return (
      <div className="w-28">
        <Badge tone="blue" dot>
          Running {p.toFixed(0)}%
        </Badge>
        <Progress value={p} tone="blue" className="mt-1.5 h-1" />
      </div>
    );
  }
  if (!t.last) return <Badge dot>Not run yet</Badge>;
  if (t.last.status === "success")
    return (
      <Badge tone="green" dot>
        Up to date
      </Badge>
    );
  if (t.last.status === "cancelled")
    return (
      <Badge tone="amber" dot>
        Stopped
      </Badge>
    );
  return (
    <span title={t.last.error ?? ""}>
      <Badge tone="red" dot>
        Failed
      </Badge>
    </span>
  );
}

/* ====================================================================== task dialog */

type Form = {
  name: string;
  direction: CloudTask["direction"];
  remote: string;
  volume: string;
  folder: string;
  schedule: string;
  time: string;
  bwlimit: string;
  delete: boolean;
  versions: boolean;
  max_delete: number;
};

function toForm(t: CloudTask | null, volumes: Volume[]): Form {
  return {
    name: t?.name ?? "",
    direction: t?.direction ?? "pull",
    remote: t?.remote ?? "",
    volume: t?.volume ?? volumes[0]?.name ?? "",
    folder: t?.folder ?? "",
    schedule: !t
      ? "daily"
      : t.schedule.kind === "interval"
        ? String(t.schedule.minutes)
        : t.schedule.kind,
    time: t?.schedule.kind === "daily" ? t.schedule.time : "02:00",
    bwlimit: t?.bwlimit ?? "",
    delete: t?.delete ?? false,
    versions: t?.versions ?? true,
    max_delete: t?.max_delete ?? 50,
  };
}

function TaskDialog({
  task,
  onClose,
}: {
  task: CloudTask | null;
  onClose: () => void;
}) {
  const vols = useQuery({
    queryKey: ["volumes"],
    queryFn: () => api.get<Volume[]>("/volumes"),
  });
  const [f, setF] = useState<Form | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [pick, setPick] = useState<"remote" | "local" | null>(null);
  useEffect(() => {
    if (vols.data && !f) {
      const x = toForm(task, vols.data);
      setF(x);
      setInitial(x);
    }
  }, [vols.data]); // eslint-disable-line
  const body = f && {
    name: f.name.trim(),
    direction: f.direction,
    remote: f.remote,
    volume: f.volume,
    folder: f.folder,
    schedule:
      f.schedule === "manual"
        ? { kind: "manual" }
        : f.schedule === "daily"
          ? { kind: "daily", time: f.time }
          : { kind: "interval", minutes: Number(f.schedule) },
    bwlimit: f.bwlimit,
    delete: f.delete,
    versions: f.versions,
    max_delete: f.max_delete,
  };
  const save = useAction(
    () =>
      task
        ? api.put(`/onedrive/tasks/${task.id}`, body)
        : api.post("/onedrive/tasks", body),
    {
      success: task ? "Task saved" : "Task created",
      invalidate: ["onedrive"],
      onSuccess: onClose,
    },
  );
  if (!f || !vols.data) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF({ ...f, [k]: v });
  const changed = !task || !sameValue(f, initial);
  const valid = !!f.name.trim() && !!f.volume;
  const arrow =
    f.direction === "bisync" ? (
      <ArrowLeftRight className="size-4" />
    ) : (
      <ArrowRight
        className={cx("size-4", f.direction === "push" && "rotate-180")}
      />
    );

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={task ? `Edit ${task.name}` : "New task"}
      description="Copy files between OneDrive and this NAS"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || !changed}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {task ? "Save" : "Create task"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Direction</div>
          <div className="grid gap-2 md:grid-cols-3">
            {(Object.keys(DIR) as CloudTask["direction"][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("direction", k)}
                className={cx(
                  "rounded-xl p-3 text-left ring-1 transition",
                  f.direction === k
                    ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10"
                    : "ring-zinc-200 hover:ring-zinc-300 dark:ring-white/10",
                )}
              >
                <div className="truncate text-sm font-semibold">
                  {DIR[k].label}
                  {k === "bisync" && (
                    <span className="ml-1.5 align-middle text-[11px] font-semibold text-amber-600 uppercase">
                      Beta
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">
                  {DIR[k].text}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr] [&>*]:min-w-0">
          <Field label="OneDrive folder">
            <PathButton
              icon={<Cloud className="size-4 text-[#0364b8]" />}
              text={odPath(f.remote)}
              onClick={() => setPick("remote")}
            />
          </Field>
          <div className="hidden pb-3 text-zinc-400 md:block">{arrow}</div>
          <Field label="NAS folder">
            <PathButton
              icon={<Folder className="size-4 text-brand-500" />}
              text={f.volume ? nasPath(f) : "Choose a volume"}
              onClick={() => setPick("local")}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
          <Field label="Task name">
            <Input
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Photos backup"
              maxLength={64}
            />
          </Field>
          <Field label="Schedule">
            <div className="flex gap-2">
              <Select
                value={f.schedule}
                onChange={(e) => set("schedule", e.target.value)}
                className="min-w-0 flex-1"
              >
                {SCHEDULES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              {f.schedule === "daily" && (
                <Input
                  type="time"
                  value={f.time}
                  onChange={(e) => set("time", e.target.value)}
                  className="shrink-0"
                  style={{ width: "9rem" }}
                />
              )}
            </div>
          </Field>
          <Field label="Speed limit">
            <Select
              value={f.bwlimit}
              onChange={(e) => set("bwlimit", e.target.value)}
            >
              <option value="">No limit</option>
              <option value="1M">1 MB/s</option>
              <option value="5M">5 MB/s</option>
              <option value="10M">10 MB/s</option>
              <option value="50M">50 MB/s</option>
            </Select>
          </Field>
        </div>

        {f.direction === "bisync" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleBox
              title="Changed on both sides"
              text="Both copies are kept, one renamed"
            />
            <div className="flex h-14 items-center justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">
                  Safety stop
                </div>
                <div className="truncate text-xs text-zinc-500">
                  Stop if more files would be deleted
                </div>
              </div>
              <Select
                value={String(f.max_delete)}
                onChange={(e) => set("max_delete", Number(e.target.value))}
                className="w-24 shrink-0"
              >
                <option value="10">10%</option>
                <option value="25">25%</option>
                <option value="50">50%</option>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleBox
              title={`Delete files removed from ${f.direction === "pull" ? "OneDrive" : "the NAS"}`}
              text="Off: nothing is ever deleted (safer)"
              checked={f.delete}
              onChange={(v) => set("delete", v)}
            />
            <ToggleBox
              title="Keep old versions"
              text="Replaced files kept in .versions for 30 days"
              checked={f.versions}
              onChange={(v) => set("versions", v)}
            />
          </div>
        )}
      </div>
      {pick && (
        <FolderPicker
          kind={pick}
          volumes={vols.data}
          volume={f.volume}
          start={pick === "remote" ? f.remote : f.folder}
          onClose={() => setPick(null)}
          onPick={(p, vol) => {
            if (pick === "remote")
              setF({
                ...f,
                remote: p,
                name: f.name || (p.split("/").pop() ?? ""),
              });
            else setF({ ...f, volume: vol ?? f.volume, folder: p });
            setPick(null);
          }}
        />
      )}
    </Modal>
  );
}

function PathButton({
  icon,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl bg-white px-3.5 text-left text-sm ring-1 ring-zinc-200 transition hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-white/10"
    >
      {icon}
      <span className="truncate">{text}</span>
      <span className="ml-auto shrink-0 text-[13px] font-medium text-brand-600 dark:text-brand-400">
        Browse
      </span>
    </button>
  );
}

function ToggleBox({
  title,
  text,
  checked,
  onChange,
}: {
  title: string;
  text: string;
  checked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <div className="flex h-14 items-center justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{title}</div>
        <div className="truncate text-xs text-zinc-500">{text}</div>
      </div>
      {onChange && (
        <Switch checked={!!checked} onChange={onChange} label={title} />
      )}
    </div>
  );
}

/* ====================================================================== folder picker */

function FolderPicker({
  kind,
  volumes,
  volume,
  start,
  onClose,
  onPick,
}: {
  kind: "remote" | "local";
  volumes: Volume[];
  volume: string;
  start: string;
  onClose: () => void;
  onPick: (path: string, volume?: string) => void;
}) {
  const [vol, setVol] = useState(volume);
  const [path, setPath] = useState(start);
  const q = useQuery({
    queryKey: ["folders", kind, vol, path],
    queryFn: () =>
      kind === "remote"
        ? api.get<string[]>(
            `/onedrive/folders?path=${encodeURIComponent(path)}`,
          )
        : api.get<string[]>(
            `/onedrive/local-folders?volume=${encodeURIComponent(vol)}&path=${encodeURIComponent(path)}`,
          ),
    enabled: kind === "remote" || !!vol,
  });
  const parts = useMemo(() => path.split("/").filter(Boolean), [path]);
  const root = kind === "remote" ? "OneDrive" : vol;
  return (
    <Modal
      open
      onClose={onClose}
      title={
        kind === "remote" ? "Choose a OneDrive folder" : "Choose a NAS folder"
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={kind === "local" && !vol}
            onClick={() => onPick(path, vol)}
          >
            Use this folder
          </Button>
        </>
      }
    >
      {kind === "local" && (
        <Field label="Volume">
          <Select
            value={vol}
            onChange={(e) => {
              setVol(e.target.value);
              setPath("");
            }}
          >
            {volumes.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div
        className={cx(
          "flex flex-wrap items-center gap-1 text-[13px]",
          kind === "local" && "mt-4",
        )}
      >
        <button
          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          onClick={() => setPath("")}
        >
          {root}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-zinc-400" />
            <button
              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              onClick={() => setPath(parts.slice(0, i + 1).join("/"))}
            >
              {p}
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
        {q.isLoading ? (
          <div className="p-4">
            <PageLoader />
          </div>
        ) : q.data?.length ? (
          q.data.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPath(path ? `${path}/${name}` : name)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
            >
              <FolderOpen className="size-4 shrink-0 text-amber-500" />
              <span className="truncate">{name}</span>
              <ChevronRight className="ml-auto size-4 shrink-0 text-zinc-400" />
            </button>
          ))
        ) : (
          <div className="px-3.5 py-3 text-[13px] text-zinc-500">
            {kind === "local"
              ? "No subfolders. It is created if needed."
              : "No subfolders."}
          </div>
        )}
      </div>
      {kind === "local" && (
        <div className="mt-4">
          <Field label="Or type a new folder name">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Photos"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/* ====================================================================== log */

function LogDialog({
  task,
  onClose,
}: {
  task: CloudTask;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["onedrive-log", task.id],
    queryFn: () => api.get<string[]>(`/onedrive/tasks/${task.id}/log`),
    refetchInterval: 2000,
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Log: ${task.name}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {task.last?.error && (
        <Callout tone="danger" className="mb-3">
          {task.last.error}
        </Callout>
      )}
      <pre className="max-h-96 overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-300">
        {q.data?.length ? q.data.join("\n") : "No log yet."}
      </pre>
    </Modal>
  );
}
