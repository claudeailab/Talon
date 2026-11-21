import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  ScanSearch,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { CloudTask, FullCheck, OneDriveStatus, Schedule, VerifyResult, Volume } from "../lib/types";
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
  MenuSeparator,
  Modal,
  PageHeader,
  PageLoader,
  Progress,
  Select,
  TimeInput,
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

/** "4 min", "1 h 10 min" */
export function dur(secs: number | null | undefined): string {
  if (secs == null) return "";
  if (secs < 90) return `${Math.max(1, Math.round(secs))} s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  const verify = useAction(
    ({ id, mode }: { id: string; mode: "quick" | "full" }) =>
      api.post(`/onedrive/tasks/${id}/verify`, { mode }),
    { invalidate: ["onedrive"] },
  );
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
            title="Set up the EntraID app first"
            text="OneDrive sign-in uses your own Microsoft Entra ID app."
            action={
              <Button
                variant="primary"
                onClick={() => navigate("/settings?tab=entra")}
              >
                Open EntraID settings
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
              {d.connected && d.account ? (
                <>
                  {/* phones: the email on its own line, the details below */}
                  <span className="block sm:inline">{d.account.email}</span>
                  <span className="hidden sm:inline"> · </span>
                  {`${d.account.drive_type === "personal" ? "Personal" : "Work or school"} · ${bytes(d.account.used)} of ${bytes(d.account.total)} used`}
                </>
              ) : waiting
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
                    <th className="hidden px-3 py-3 xl:table-cell">
                      Direction
                    </th>
                    <th className="hidden px-3 py-3 lg:table-cell">Schedule</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Last run</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Status</th>
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
                        {/* phones: status and schedule under the name */}
                        <div className="mt-1.5 flex min-w-0 items-center gap-2 sm:hidden">
                          <TaskStatus t={t} />
                          <span className="truncate text-xs text-zinc-500">{scheduleLabel(t.schedule)}</span>
                        </div>
                      </td>
                      <td className="hidden px-3 xl:table-cell">
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
                      <td className="hidden px-3 sm:table-cell">
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
                            {!t.source_file && (
                              <>
                                <MenuSeparator />
                                <MenuItem
                                  icon={<ScanSearch />}
                                  disabled={!!t.running || !d.rclone.installed}
                                  hint={t.estimate?.quick_secs ? `~${dur(t.estimate.quick_secs)}` : undefined}
                                  onClick={() => verify.mutate({ id: t.id, mode: "quick" })}
                                >
                                  Quick check now
                                </MenuItem>
                                <MenuItem
                                  icon={<ShieldCheck />}
                                  disabled={!!t.running || !d.rclone.installed}
                                  hint={t.estimate?.full_secs ? `~${dur(t.estimate.full_secs)}` : undefined}
                                  onClick={() => verify.mutate({ id: t.id, mode: "full" })}
                                >
                                  Full check now
                                </MenuItem>
                                <MenuSeparator />
                              </>
                            )}
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
      {logOf && <LogDialog task={d.tasks.find((t) => t.id === logOf.id) ?? logOf} onClose={() => setLogOf(null)} />}
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

type Run = NonNullable<CloudTask["running"]>;
const num = (n: number) => n.toLocaleString("en-GB");

/** What a run is doing: comparing both sides first, then copying. */
function runLabel(r: Run) {
  const p = `${(r.percent ?? 0).toFixed(0)}%`;
  if (r.phase === "verifying") return `Verifying ${p}`;
  if (r.phase === "fixing") return `Copying again ${p}`;
  return r.percent === null ? "Comparing" : `Copying ${p}`;
}

function runDetail(r: Run) {
  if (r.phase === "verifying")
    return `${num(r.checks)} of ${num(r.total_checks)} files` + (r.eta != null ? ` · about ${dur(r.eta)} left` : "");
  if (r.percent === null) return `${num(r.listed)} found · ${num(r.checks)} compared`;
  const done = r.checks + r.files, total = Math.max(done, r.total_checks + r.total_files);
  return (
    <>
      {num(done)} of {num(total)} files
      {/* copied and speed only where they fit on one line */}
      <span className="hidden sm:inline"> · {bytes(r.bytes)} copied</span>
      {" · "}{bytes(Math.max(0, r.total_bytes - r.bytes))} left
      <span className="hidden sm:inline">{r.speed ? ` · ${bytes(r.speed)}/s` : ""}</span>
    </>
  );
}

const wait = (s: number) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

/** Whether rclone is still making progress, so a long wait never looks like a hang. */
function RunActivity({ r }: { r: Run }) {
  const [tone, text] = r.throttled
    ? ["amber", `OneDrive is throttling · trying again in ${wait(r.throttled)}`]
    : r.idle >= 60
      ? ["amber", `No change for ${wait(r.idle)} · waiting for OneDrive`]
      : ["green", (r.phase === "verifying" && r.read_speed ? `Working · disks reading ${bytes(r.read_speed)}/s · ` : "Working · ") +
          (r.idle <= 3 ? "updated just now" : `updated ${r.idle} s ago`)];
  return (
    <div className={cx("mt-1.5 flex items-center gap-1.5 truncate text-xs",
      tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500")}>
      <span className={cx("size-1.5 shrink-0 rounded-full",
        tone === "amber" ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function TaskStatus({ t }: { t: CloudTask }) {
  if (t.running) {
    return (
      <div className="w-28">
        <Badge tone="blue" dot>
          {runLabel(t.running)}
        </Badge>
        <Progress value={t.running.percent} tone="blue" className="mt-1.5 h-1" />
      </div>
    );
  }
  if (!t.last) return <Badge dot>Not run yet</Badge>;
  const v = t.last_verify;
  if (v?.status === "failed")
    return (
      <Badge tone="amber" dot>
        {num(v.unresolved_count)} file{v.unresolved_count === 1 ? "" : "s"} not verified
      </Badge>
    );
  if (v?.status === "error")
    return (
      <Badge tone="amber" dot>
        Check failed
      </Badge>
    );
  if (t.last.status === "success")
    return (
      <Badge tone="green" dot>
        {v && v.started >= t.last.started ? "Up to date · verified" : "Up to date"}
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
  source_file: boolean;
  retries: number;
  verify: "off" | "quick" | "full";
  full_kind: FullCheck["kind"];
  full_weekday: number;
  full_day: number;
  full_time: string;
};

const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");

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
    source_file: t?.source_file ?? false,
    retries: t?.retries ?? 2,
    verify: t?.verify ?? "quick",
    full_kind: t?.full_check?.kind ?? "never",
    full_weekday: t?.full_check?.kind === "weekly" ? t.full_check.weekday : 6,
    full_day: t?.full_check?.kind === "monthly" ? t.full_check.day : 1,
    full_time: t?.full_check && t.full_check.kind !== "never" ? t.full_check.time : "03:00",
  };
}

function fullCheck(f: Form): FullCheck {
  if (f.full_kind === "weekly") return { kind: "weekly", weekday: f.full_weekday, time: f.full_time };
  if (f.full_kind === "monthly") return { kind: "monthly", day: f.full_day, time: f.full_time };
  return { kind: "never" };
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
    source_file: f.source_file,
    retries: f.retries,
    verify: f.verify,
    full_check: fullCheck(f),
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
  // which side is copied from; only that side may be a single file
  const fileOn = f.source_file ? (f.direction === "pull" ? "remote" : "local") : null;
  const setDirection = (d: CloudTask["direction"]) => {
    if (!fileOn || (d === "pull" && fileOn === "remote") || (d === "push" && fileOn === "local"))
      return set("direction", d);
    // the chosen file is no longer on the source side: use its folder instead
    setF({ ...f, direction: d, source_file: false, ...(fileOn === "remote" ? { remote: parentOf(f.remote) } : { folder: parentOf(f.folder) }) });
  };
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
                onClick={() => setDirection(k)}
                disabled={k === "bisync" && f.source_file}
                title={k === "bisync" && f.source_file ? "Two-way sync works with folders only" : undefined}
                className={cx(
                  "rounded-xl p-3 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-45",
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
          <Field label={f.direction === "pull" ? "OneDrive folder or file" : "OneDrive folder"}>
            <PathButton
              icon={fileOn === "remote" ? <FileText className="size-4 text-[#0364b8]" /> : <Cloud className="size-4 text-[#0364b8]" />}
              text={odPath(f.remote)}
              onClick={() => setPick("remote")}
            />
          </Field>
          <div className="hidden pb-3 text-zinc-400 md:block">{arrow}</div>
          <Field label={f.direction === "push" ? "NAS folder or file" : "NAS folder"}>
            <PathButton
              icon={fileOn === "local" ? <FileText className="size-4 text-brand-500" /> : <Folder className="size-4 text-brand-500" />}
              text={f.volume ? nasPath(f) : "Choose a volume"}
              onClick={() => setPick("local")}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-4 [&>*]:min-w-0">
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
                <div className="w-[6rem] shrink-0">
                  <TimeInput value={f.time} onChange={(v) => set("time", v)} />
                </div>
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
          <Field label="If it fails">
            <Select value={f.retries} onChange={(e) => set("retries", Number(e.target.value))}>
              <option value={0}>Don't retry</option>
              <option value={1}>Retry once</option>
              <option value={2}>Retry 2 times</option>
              <option value={3}>Retry 3 times</option>
              <option value={5}>Retry 5 times</option>
            </Select>
          </Field>
        </div>

        {f.direction === "bisync" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleBox
              title="Changed on both sides"
              text="Both copies are kept, one renamed"
            />
            <div className="flex min-h-14 items-center py-2 justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
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
            {f.source_file ? (
              <ToggleBox title="Single file" text="Only this file is copied; nothing is deleted" />
            ) : (
              <ToggleBox
                title={`Delete files removed from ${f.direction === "pull" ? "OneDrive" : "the NAS"}`}
                text="Off: nothing is ever deleted (safer)"
                checked={f.delete}
                onChange={(v) => set("delete", v)}
              />
            )}
            <ToggleBox
              title="Keep old versions"
              text="Replaced files kept in .versions for 30 days"
              checked={f.versions}
              onChange={(v) => set("versions", v)}
            />
          </div>
        )}
        {!f.source_file && <VerifySection f={f} set={set} task={task} />}
      </div>
      {pick && (
        <FolderPicker
          kind={pick}
          allowFiles={(pick === "remote" && f.direction === "pull") || (pick === "local" && f.direction === "push")}
          volumes={vols.data}
          volume={f.volume}
          start={pick === "remote" ? (fileOn === "remote" ? parentOf(f.remote) : f.remote) : fileOn === "local" ? parentOf(f.folder) : f.folder}
          onClose={() => setPick(null)}
          onPick={(p, isFile, vol) => {
            const name = f.name || (p.split("/").pop() ?? "");
            if (pick === "remote") setF({ ...f, remote: p, name, source_file: f.direction === "pull" ? isFile : f.source_file });
            else setF({ ...f, volume: vol ?? f.volume, folder: p, name: f.direction === "push" ? name : f.name, source_file: f.direction === "push" ? isFile : f.source_file });
            setPick(null);
          }}
        />
      )}
    </Modal>
  );
}

/** Verify after each run (off / quick / full) and an optional scheduled full
 * check, each with how long it takes for this task's own files. */
function VerifySection({
  f,
  set,
  task,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  task: CloudTask | null;
}) {
  const e = task?.estimate;
  const known = !!e?.files;
  const est = (secs: number | null | undefined) =>
    !known ? "after the first run" : secs ? `about ${dur(secs)}` : e?.measuring ? "measuring…" : "after the first run";
  const options: { v: Form["verify"]; title: string; text: string; time?: string }[] = [
    { v: "off", title: "Off", text: "No check" },
    { v: "quick", title: "Quick", text: "Names and sizes", time: est(e?.quick_secs) },
    { v: "full", title: "Full", text: "Contents (checksums)", time: est(e?.full_secs) },
  ];
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium">Verify after each run</div>
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={f.verify === o.v}
            onClick={() => set("verify", o.v)}
            className={cx(
              "flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition sm:block",
              f.verify === o.v
                ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-500/10"
                : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/[0.03]",
            )}
          >
            <div className="w-12 shrink-0 truncate text-sm font-medium sm:w-auto">{o.title}</div>
            <div className="min-w-0 flex-1 truncate text-xs text-zinc-500">{o.text}</div>
            {o.time && <div className="shrink-0 truncate text-xs font-medium text-brand-600 sm:mt-1 dark:text-brand-300">{o.time}</div>}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <Field label="Also run a full check">
          <div className="grid grid-cols-[1fr_6rem] gap-2 sm:flex">
            <Select
              value={f.full_kind}
              onChange={(ev) => set("full_kind", ev.target.value as Form["full_kind"])}
              className="col-span-2 min-w-0 flex-1"
            >
              <option value="never">Never</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
            {f.full_kind === "weekly" && (
              <Select value={f.full_weekday} onChange={(ev) => set("full_weekday", Number(ev.target.value))} className="min-w-0 flex-1">
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>{w}</option>
                ))}
              </Select>
            )}
            {f.full_kind === "monthly" && (
              <Select value={f.full_day} onChange={(ev) => set("full_day", Number(ev.target.value))} className="min-w-0 flex-1">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>Day {d}</option>
                ))}
              </Select>
            )}
            {f.full_kind !== "never" && (
              <div className="w-[6rem] shrink-0">
                <TimeInput value={f.full_time} onChange={(v) => set("full_time", v)} />
              </div>
            )}
          </div>
        </Field>
        {known && (
          <div className="flex items-end">
            <div className="w-full truncate rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-500 dark:bg-white/[0.03]">
              This task: <span className="text-zinc-800 dark:text-zinc-200">{num(e!.files!)} files · {bytes(e!.bytes)}</span>
              {e!.speed ? <> · disks read <span className="text-zinc-800 dark:text-zinc-200">{bytes(e!.speed)}/s</span></> : null}
            </div>
          </div>
        )}
      </div>
    </div>
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

export function ToggleBox({
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
    <div className="flex min-h-14 items-center py-2 justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
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

type Item = { name: string; folder: boolean; size: number };

function FolderPicker({
  kind,
  allowFiles,
  volumes,
  volume,
  start,
  onClose,
  onPick,
}: {
  kind: "remote" | "local";
  allowFiles: boolean;
  volumes: Volume[];
  volume: string;
  start: string;
  onClose: () => void;
  onPick: (path: string, isFile: boolean, volume?: string) => void;
}) {
  const [vol, setVol] = useState(volume);
  const [path, setPath] = useState(start);
  const [selected, setSelected] = useState<Item | null>(null);
  const q = useQuery({
    queryKey: ["items", kind, vol, path],
    queryFn: () =>
      kind === "remote"
        ? api.get<Item[]>(`/onedrive/folders?path=${encodeURIComponent(path)}`)
        : api.get<Item[]>(`/onedrive/local-folders?volume=${encodeURIComponent(vol)}&path=${encodeURIComponent(path)}`),
    enabled: kind === "remote" || !!vol,
  });
  const items = (q.data ?? []).filter((i) => i.folder || allowFiles);
  const parts = useMemo(() => path.split("/").filter(Boolean), [path]);
  const root = kind === "remote" ? "OneDrive" : vol;
  const join = (name: string) => (path ? `${path}/${name}` : name);
  const open = (p: string) => {
    setPath(p);
    setSelected(null);
  };
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const mkdir = useAction(() => api.post<{ path: string }>("/onedrive/local-folders", { volume: vol, path, name: newName.trim() }), {
    success: `Folder ${newName.trim()} created`,
    onSuccess: (r) => {
      open(r.path); // open the new folder
      setCreating(false);
      setNewName("");
    },
  });
  const confirm = () => (selected ? onPick(join(selected.name), !selected.folder, vol) : onPick(path, false, vol));

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "remote" ? "Choose from OneDrive" : "Choose from the NAS"}
      description="Click to select. Double-click a folder to open it."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {kind === "local" && (
              <Button icon={<FolderPlus className="size-4" />} disabled={!vol || creating} onClick={() => setCreating(true)}>
                New folder
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={kind === "local" && !vol} onClick={confirm}>
              {selected ? "Select" : "Use this folder"}
            </Button>
          </div>
        </div>
      }
    >
      {kind === "local" && (
        <div className="mb-4">
          <Field label="Volume">
            <Select
              value={vol}
              onChange={(e) => {
                setVol(e.target.value);
                open("");
              }}
            >
              {volumes.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => open("")}>
          {root}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-zinc-400" />
            <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => open(parts.slice(0, i + 1).join("/"))}>
              {p}
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 ring-zinc-200 select-none dark:divide-white/5 dark:ring-white/10">
        {q.isLoading ? (
          <div className="p-4">
            <PageLoader />
          </div>
        ) : items.length ? (
          items.map((it) => {
            const on = selected?.name === it.name;
            return (
              <div
                key={it.name}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(on ? null : it)}
                onDoubleClick={() => (it.folder ? open(join(it.name)) : onPick(join(it.name), true, vol))}
                onKeyDown={(e) => e.key === "Enter" && (it.folder ? open(join(it.name)) : setSelected(it))}
                className={cx(
                  "flex min-h-11 py-2 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left text-sm",
                  on ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
                )}
              >
                {it.folder ? <FolderOpen className="size-4 shrink-0 text-amber-500" /> : <FileText className="size-4 shrink-0 text-zinc-400" />}
                <span className={cx("truncate", on && "font-medium")}>{it.name}</span>
                {it.folder ? (
                  <IconButton
                    label={`Open ${it.name}`}
                    className="ml-auto size-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(join(it.name));
                    }}
                  >
                    <ChevronRight className="size-4" />
                  </IconButton>
                ) : (
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">{bytes(it.size)}</span>
                )}
              </div>
            );
          })
        ) : (
          <div className="px-3.5 py-3 text-[13px] text-zinc-500">{allowFiles ? "This folder is empty." : "No subfolders."}</div>
        )}
      </div>
      {creating && (
        <div className="mt-3 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && mkdir.mutate()}
            placeholder="Folder name"
            autoFocus
          />
          <Button variant="primary" disabled={!newName.trim()} loading={mkdir.isPending} onClick={() => mkdir.mutate()}>
            Create
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
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
  // keep the newest line in view, unless the user scrolled up to read something
  const list = useRef<HTMLUListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [q.data]);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Log: ${task.name}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {/* the last run's error, until the task runs again */}
      {!task.running && task.last?.status === "error" && task.last.error && (
        <Callout tone="danger" title={`Last run failed on ${dateTime(task.last.finished)}`} className="mb-3">
          {task.last.error}
        </Callout>
      )}
      {!task.running && task.last_verify && <VerifyCallout v={task.last_verify} task={task} />}
      {task.running && (
        <div className="mb-3">
          <Steps r={task.running} verify={task.verify ?? "off"} />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="shrink-0 font-medium">{runLabel(task.running)}</span>
            <span className="truncate text-zinc-500">{runDetail(task.running)}</span>
          </div>
          <Progress value={task.running.percent} tone="blue" className="mt-1.5 h-1.5" />
          <RunActivity r={task.running} />
        </div>
      )}
      {q.data?.length ? (
        <ul
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="max-h-[50vh] max-h-[50dvh] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-200 sm:max-h-[60vh] dark:divide-white/5 dark:ring-white/10"
        >
          {q.data.map((line, i) => (
            <LogLine key={i} line={line} />
          ))}
        </ul>
      ) : (
        <div className="py-8 text-center text-sm text-zinc-500">No log yet.</div>
      )}
    </Modal>
  );
}

/** Where a run with verification is: Compare › Copy › Verify. */
function Steps({ r, verify }: { r: Run; verify: "off" | "quick" | "full" }) {
  if (r.mode !== "run" || verify === "off") return null;      // a check on its own has one step
  const at = r.phase === "comparing" ? 0 : r.phase === "copying" ? 1 : 2;
  return (
    <div className="mb-2 flex items-center gap-1.5 truncate text-xs">
      {["Compare", "Copy", "Verify"].map((name, i) => (
        <span key={name} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3 text-zinc-400" />}
          <span className={cx(i === at ? "font-semibold text-sky-600 dark:text-sky-400" : "text-zinc-500")}>
            {i < at ? "✓ " : ""}{name}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The last check's result: passed, fixed by copying again, or what is still wrong. */
function VerifyCallout({ v, task }: { v: VerifyResult; task: CloudTask }) {
  const kind = v.mode === "quick" ? "Quick check" : "Full check";
  const when = dateTime(v.finished);
  const where = task.direction === "pull" ? "on the NAS" : task.direction === "push" ? "in OneDrive" : "on one side";
  if (v.status === "ok")
    return (
      <Callout tone="success" title={`${kind} on ${when}: all ${num(v.checked)} files match`} className="mb-3" />
    );
  if (v.status === "fixed")
    return (
      <Callout tone="success" title={`${kind} on ${when}: all ${num(v.checked)} files match`} className="mb-3">
        {num(v.fixed)} file{v.fixed === 1 ? " was" : "s were"} missing or different {where} and
        {v.fixed === 1 ? " was" : " were"} copied again automatically.
      </Callout>
    );
  if (v.status === "error")
    return (
      <Callout tone="warning" title={`${kind} on ${when} could not finish`} className="mb-3">
        {v.error}
      </Callout>
    );
  return (
    <Callout tone="warning" title={`${kind} on ${when}: ${num(v.unresolved_count)} of ${num(v.checked)} files not verified`} className="mb-3">
      {v.fixed > 0 && <div>{num(v.fixed)} were copied again automatically; these still do not match:</div>}
      <ul className="mt-2 space-y-1">
        {v.unresolved.map((x) => (
          <li key={x.kind + x.path} className="flex min-w-0 items-center gap-2">
            <Badge tone={x.kind === "different" ? "red" : "amber"}>
              {x.kind === "missing" ? "Missing" : x.kind === "different" ? "Different" : "Unreadable"}
            </Badge>
            <span className="min-w-0 [overflow-wrap:anywhere]">{x.path}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/** One log entry: "time<TAB>LEVEL<TAB>file<TAB>message", or any older plain line. */
function LogLine({ line }: { line: string }) {
  const parts = line.split("\t");
  if (parts.length !== 4)
    return <li className="px-3 py-2 font-mono text-[12px] text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">{line}</li>;
  const [when, level, file, msg] = parts;
  const tone = level === "ERROR" ? "red" : level === "NOTICE" || level === "WARNING" ? "amber" : null;
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline gap-2 text-[13px]">
        {when && <span className="tabular shrink-0 text-xs text-zinc-400">{when}</span>}
        {tone && (
          <Badge tone={tone} className="shrink-0">
            {level === "ERROR" ? "Error" : "Warning"}
          </Badge>
        )}
        <span className={cx("min-w-0 font-medium break-words", tone === "red" && "text-rose-600 dark:text-rose-400")}>{msg}</span>
      </div>
      {file && (
        <div className="mt-0.5 text-[12px] text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">
          {/* allow line breaks after each "/" so long paths wrap between folders */}
          {file.split("/").map((seg, j, all) => (
            <span key={j}>
              {seg}
              {j < all.length - 1 && (
                <>
                  /<wbr />
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
