import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
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
import { LogList } from "../components/log";
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
      description="Back up or sync folders with OneDrive"
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
            <div className="[overflow-wrap:anywhere] text-[13px] text-zinc-500">
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
                        <div className="[overflow-wrap:anywhere] font-medium">{t.name}</div>
                        <div className="[overflow-wrap:anywhere] text-xs text-zinc-500">
                          {t.direction === "push"
                            ? `${nasPath(t)} → ${odPath(t.remote)}`
                            : t.direction === "pull"
                              ? `${odPath(t.remote)} → ${nasPath(t)}`
                              : `${odPath(t.remote)} ⇄ ${nasPath(t)}`}
                        </div>
                        {/* phones: status and schedule under the name */}
                        <div className="mt-1.5 flex min-w-0 items-center gap-2 sm:hidden">
                          <TaskStatus t={t} />
                          <span className="[overflow-wrap:anywhere] text-xs text-zinc-500">{scheduleLabel(t.schedule)}</span>
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
    <div className={cx("mt-1.5 flex items-center gap-1.5 [overflow-wrap:anywhere] text-xs",
      tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500")}>
      <span className={cx("size-1.5 shrink-0 rounded-full",
        tone === "amber" ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
      <span className="[overflow-wrap:anywhere]">{text}</span>
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

type Step = "what" | "folders" | "when" | "checks" | "finish";
const STEP_ORDER: Step[] = ["what", "folders", "when", "checks", "finish"];

const INTERVALS = SCHEDULES.filter((x) => /^\d+$/.test(x.value));

/** "Back up OneDrive/Pictures to tank/Photos every day at 23:00, with ..." */
function summary(f: Form): string {
  const od = odPath(f.remote);
  const nas = nasPath(f);
  const what =
    f.direction === "pull" ? `Back up ${od} to ${nas}` : f.direction === "push" ? `Back up ${nas} to ${od}` : `Keep ${od} and ${nas} the same`;
  const when =
    f.schedule === "manual"
      ? "when you start it"
      : f.schedule === "daily"
        ? `every day at ${f.time}`
        : (INTERVALS.find((x) => x.value === f.schedule)?.label ?? "").toLowerCase();
  const parts = [`${what} ${when}`];
  if (!f.source_file) {
    if (f.verify !== "off") parts.push(`a ${f.verify} check after each run`);
    if (f.full_kind === "weekly") parts.push(`a full check every ${WEEKDAYS[f.full_weekday]} at ${f.full_time}`);
    if (f.full_kind === "monthly") parts.push(`a full check on day ${f.full_day} of every month at ${f.full_time}`);
  }
  return parts.length === 1 ? `${parts[0]}.` : `${parts[0]}, with ${parts.slice(1).join(" and ")}.`;
}

/** One big choice in a wizard step. */
function Choice({
  on,
  onClick,
  title,
  text,
  icon,
  right,
  disabled,
  badge,
  note,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  text: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  disabled?: boolean;
  badge?: string;
  /** a third line, e.g. how long it takes */
  note?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-45",
        on ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/[0.03]",
      )}
    >
      {icon ?? (
        <span className={cx("size-[18px] shrink-0 rounded-full ring-2", on ? "bg-white ring-[5px] ring-brand-500" : "ring-zinc-400 dark:ring-zinc-600")} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {title}
          {badge && <span className="ml-1.5 align-middle text-[11px] font-semibold text-brand-600 uppercase dark:text-brand-300">{badge}</span>}
        </span>
        <span className="block text-[13px] text-zinc-500">{text}</span>
        {note && <span className="mt-0.5 block text-xs font-medium text-brand-600 dark:text-brand-300">{note}</span>}
      </span>
      {right}
    </button>
  );
}

function DirIcon({ d }: { d: CloudTask["direction"] }) {
  const c = {
    pull: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
    push: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
    bisync: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  }[d];
  return (
    <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl", c)}>
      {d === "bisync" ? <ArrowLeftRight className="size-5" /> : d === "pull" ? <Cloud className="size-5" /> : <Folder className="size-5" />}
    </span>
  );
}

/** A new task is a wizard, one question per step; editing opens a summary
 * where each part has "Change". */
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
  const [step, setStep] = useState<Step | "summary">(task ? "summary" : "what");
  const [more, setMore] = useState(false);
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
  const steps = STEP_ORDER.filter((s) => s !== "checks" || !f.source_file);
  const at = step === "summary" ? -1 : steps.indexOf(step);
  const defaultName = () =>
    f.name.trim() ||
    (f.direction === "push" ? f.folder.split("/").pop() || f.volume : f.remote.split("/").pop() || "OneDrive") +
      (f.direction === "bisync" ? " sync" : " backup");
  const go = (s: Step | "summary") => {
    if (s === "finish" || s === "summary") setF({ ...f, name: defaultName() });
    setStep(s);
  };
  const changed = !task || !sameValue(f, initial);
  const valid = !!f.name.trim() && !!f.volume;
  const e = task?.estimate;
  const known = !!e?.files;
  const est = (secs: number | null | undefined) =>
    !known ? "Time shown after the first run" : secs ? `about ${dur(secs)}` : e?.measuring ? "Measuring the time…" : "Time shown after the first run";
  const od = odPath(f.remote), nas = nasPath(f);
  const deleteText =
    f.direction === "pull"
      ? ["Delete on Talon what I delete on OneDrive", "When a file is deleted on OneDrive it will also be deleted on Talon"]
      : ["Delete on OneDrive what I delete on Talon", "When a file is deleted on Talon it will also be deleted on OneDrive"];

  const content: Record<Step, React.ReactNode> = {
    what: (
      <>
        <h3 className="text-lg font-semibold">What do you want to do?</h3>
        <div className="mt-4 space-y-2.5">
          <Choice on={f.direction === "pull"} onClick={() => setDirection("pull")} icon={<DirIcon d="pull" />} title="Back up OneDrive to the NAS" text="A copy of your OneDrive files on the NAS" />
          <Choice on={f.direction === "push"} onClick={() => setDirection("push")} icon={<DirIcon d="push" />} title="Back up the NAS to OneDrive" text="A copy of NAS files in OneDrive" />
          <Choice on={f.direction === "bisync"} onClick={() => setDirection("bisync")} disabled={f.source_file} icon={<DirIcon d="bisync" />} title="Keep both the same" badge="Beta" text="Changes on either side go to the other" />
        </div>
      </>
    ),
    folders: (
      <>
        <h3 className="text-lg font-semibold">Which folders?</h3>
        <div className="mt-4 space-y-4">
          {(f.direction === "push" ? (["local", "remote"] as const) : (["remote", "local"] as const)).map((side, i) => (
            <Field
              key={side}
              label={
                f.direction === "bisync"
                  ? side === "remote" ? "OneDrive folder" : "NAS folder"
                  : `${i === 0 ? "From" : "To"} ${side === "remote" ? "OneDrive" : "the NAS"}`
              }
            >
              <PathButton
                icon={
                  side === "remote"
                    ? fileOn === "remote" ? <FileText className="size-4 text-[#0364b8]" /> : <Cloud className="size-4 text-[#0364b8]" />
                    : fileOn === "local" ? <FileText className="size-4 text-brand-500" /> : <Folder className="size-4 text-brand-500" />
                }
                text={side === "remote" ? (f.remote ? od : "Everything in OneDrive") : f.volume ? nas : "Choose a volume"}
                onClick={() => setPick(side)}
              />
            </Field>
          ))}
          {f.direction !== "bisync" && (
            <p className="text-xs text-zinc-500">You can also choose a single file to copy.</p>
          )}
        </div>
      </>
    ),
    when: (
      <>
        <h3 className="text-lg font-semibold">When should it run?</h3>
        <div className="mt-4 space-y-2.5">
          <Choice
            on={f.schedule === "daily"}
            onClick={() => set("schedule", "daily")}
            title="Every day"
            text="Best for most backups"
            right={f.schedule === "daily" && (
              <div className="w-[6rem] shrink-0" onClick={(ev) => ev.stopPropagation()}>
                <TimeInput value={f.time} onChange={(v) => set("time", v)} />
              </div>
            )}
          />
          <Choice
            on={/^\d+$/.test(f.schedule)}
            onClick={() => !/^\d+$/.test(f.schedule) && set("schedule", "360")}
            title="Every few hours"
            text="For files that change often"
            right={/^\d+$/.test(f.schedule) && (
              <div className="shrink-0" onClick={(ev) => ev.stopPropagation()}>
                <Select value={f.schedule} onChange={(ev) => set("schedule", ev.target.value)}>
                  {INTERVALS.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </div>
            )}
          />
          <Choice on={f.schedule === "manual"} onClick={() => set("schedule", "manual")} title="Only when I start it" text="Run it from the task list" />
        </div>
      </>
    ),
    checks: (
      <>
        <h3 className="text-lg font-semibold">How carefully should Talon check?</h3>
        <p className="mt-1 text-sm text-zinc-500">After each run, files that are missing or different are copied again.</p>
        <div className="mt-4 space-y-2.5">
          <Choice on={f.verify === "off"} onClick={() => set("verify", "off")} title="Don't check" text="Trust each run" />
          <Choice on={f.verify === "quick"} onClick={() => set("verify", "quick")} title="Quick check" badge="Recommended" text="Every file is there, with the same size"
            note={est(e?.quick_secs)} />
          <Choice on={f.verify === "full"} onClick={() => set("verify", "full")} title="Full check" text="Every file's contents are identical"
            note={est(e?.full_secs)} />
        </div>
        <div className="mt-5">
          <div className="mb-1.5 text-[13px] font-medium">Also a full check</div>
          <div className="grid grid-cols-[1fr_6rem] gap-2 sm:flex">
            <Select value={f.full_kind} onChange={(ev) => set("full_kind", ev.target.value as Form["full_kind"])} className="col-span-2 min-w-0 sm:w-40 sm:flex-none">
              <option value="never">Never</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </Select>
            {f.full_kind === "weekly" && (
              <Select value={f.full_weekday} onChange={(ev) => set("full_weekday", Number(ev.target.value))} className="min-w-0 sm:w-40 sm:flex-none">
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>{w}</option>
                ))}
              </Select>
            )}
            {f.full_kind === "monthly" && (
              <Select value={f.full_day} onChange={(ev) => set("full_day", Number(ev.target.value))} className="min-w-0 sm:w-40 sm:flex-none">
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
          {known && (
            <p className="mt-2 text-xs text-zinc-500">
              Times are for this task's {num(e!.files!)} files ({bytes(e!.bytes)}).
            </p>
          )}
        </div>
      </>
    ),
    finish: (
      <>
        <h3 className="text-lg font-semibold">{task ? "Options" : "Almost done"}</h3>
        <div className="mt-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 dark:bg-white/[0.03] dark:text-zinc-300">{summary(f)}</div>
        <div className="mt-4 space-y-3">
          <Field label="Name">
            <Input value={f.name} onChange={(ev) => set("name", ev.target.value)} maxLength={64} />
          </Field>
          {f.direction !== "bisync" && !f.source_file && (
            <ToggleBox title={deleteText[0]} text={deleteText[1]} checked={f.delete} onChange={(v) => set("delete", v)} />
          )}
          {f.direction === "pull" && (
            <Callout tone="info">
              When a file changes, the old copy is kept for 30 days. Find it under <b>Previous versions</b> in Files.
            </Callout>
          )}
          <button type="button" className="flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400" onClick={() => setMore(!more)}>
            More options <ChevronRight className={cx("size-4 transition", more && "rotate-90")} />
          </button>
          {more && (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label="If it fails">
                <Select value={f.retries} onChange={(ev) => set("retries", Number(ev.target.value))}>
                  <option value={0}>Don't retry</option>
                  <option value={1}>Retry once</option>
                  <option value={2}>Retry 2 times</option>
                  <option value={3}>Retry 3 times</option>
                  <option value={5}>Retry 5 times</option>
                </Select>
              </Field>
              <Field label="Speed limit">
                <Select value={f.bwlimit} onChange={(ev) => set("bwlimit", ev.target.value)}>
                  <option value="">No limit</option>
                  <option value="1M">1 MB/s</option>
                  <option value="5M">5 MB/s</option>
                  <option value="10M">10 MB/s</option>
                  <option value="50M">50 MB/s</option>
                </Select>
              </Field>
              {f.direction === "bisync" && (
                <Field label="Stop if more files would be deleted than">
                  <Select value={String(f.max_delete)} onChange={(ev) => set("max_delete", Number(ev.target.value))}>
                    <option value="10">10%</option>
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                  </Select>
                </Field>
              )}
            </div>
          )}
        </div>
      </>
    ),
  };

  const checksText = f.source_file
    ? "Single files are not checked"
    : [f.verify === "off" ? "No check after each run" : `${f.verify === "quick" ? "Quick" : "Full"} check after each run`,
       f.full_kind === "weekly" ? `full check every ${WEEKDAYS[f.full_weekday]} at ${f.full_time}`
         : f.full_kind === "monthly" ? `full check on day ${f.full_day} at ${f.full_time}` : ""].filter(Boolean).join(" · ");
  const rows: { label: string; value: string; step: Step }[] = [
    { label: "What", value: f.direction === "pull" ? "Back up OneDrive to the NAS" : f.direction === "push" ? "Back up the NAS to OneDrive" : "Keep both the same", step: "what" },
    { label: "Folders", value: f.direction === "push" ? `${nas} → ${od}` : f.direction === "pull" ? `${od} → ${nas}` : `${od} ⇄ ${nas}`, step: "folders" },
    { label: "When", value: scheduleLabel(body!.schedule as Schedule), step: "when" },
    ...(f.source_file ? [] : [{ label: "Checks", value: checksText, step: "checks" as Step }]),
    { label: "Options", value: [f.name, f.direction === "bisync" || f.source_file ? "" : f.delete ? "Deletes what you delete" : "Never deletes"].filter(Boolean).join(" · "), step: "finish" },
  ];

  const editing = !!task;
  const footer =
    step === "summary" ? (
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid || !changed} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </>
    ) : editing ? (
      <Button variant="primary" disabled={step === "folders" && !f.volume} onClick={() => go("summary")}>Done</Button>
    ) : (
      <>
        {at > 0 && <Button variant="ghost" onClick={() => setStep(steps[at - 1])} className="mr-auto">Back</Button>}
        {at < steps.length - 1 ? (
          <Button variant="primary" disabled={step === "folders" && !f.volume} onClick={() => go(steps[at + 1])}>Next</Button>
        ) : (
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Create task</Button>
        )}
      </>
    );

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={editing ? task.name : "New OneDrive task"}
      description={step === "summary" || editing ? undefined : `Step ${at + 1} of ${steps.length}`}
      footer={footer}
    >
      {step === "summary" ? (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">{r.label}</div>
                <div className="text-sm [overflow-wrap:anywhere]">{r.value}</div>
              </div>
              <button type="button" className="shrink-0 text-sm font-medium text-brand-600 dark:text-brand-400" onClick={() => go(r.step)}>
                Change
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {!editing && (
            <div className="mb-5 flex gap-1.5" aria-hidden>
              {steps.map((s, i) => (
                <span key={s} className={cx("h-1 flex-1 rounded-full", i <= at ? "bg-brand-500" : "bg-zinc-200 dark:bg-white/10")} />
              ))}
            </div>
          )}
          {content[step]}
        </>
      )}
      {pick && (
        <FolderPicker
          kind={pick}
          allowFiles={(pick === "remote" && f.direction === "pull") || (pick === "local" && f.direction === "push")}
          volumes={vols.data}
          volume={f.volume}
          start={pick === "remote" ? (fileOn === "remote" ? parentOf(f.remote) : f.remote) : fileOn === "local" ? parentOf(f.folder) : f.folder}
          onClose={() => setPick(null)}
          onPick={(p, isFile, vol) => {
            if (pick === "remote") setF({ ...f, remote: p, source_file: f.direction === "pull" ? isFile : f.source_file });
            else setF({ ...f, volume: vol ?? f.volume, folder: p, source_file: f.direction === "push" ? isFile : f.source_file });
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
      <span className="[overflow-wrap:anywhere]">{text}</span>
      <span className="ml-auto shrink-0 text-[13px] font-medium text-brand-600 dark:text-brand-400">
        Change
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
        <div className="[overflow-wrap:anywhere] text-[13px] font-medium">{title}</div>
        <div className="[overflow-wrap:anywhere] text-xs text-zinc-500">{text}</div>
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
      description="Click to select; › or a double-click opens a folder."
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
                <span className={cx("[overflow-wrap:anywhere]", on && "font-medium")}>{it.name}</span>
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
            <span className="[overflow-wrap:anywhere] text-zinc-500">{runDetail(task.running)}</span>
          </div>
          <Progress value={task.running.percent} tone="blue" className="mt-1.5 h-1.5" />
          <RunActivity r={task.running} />
        </div>
      )}
      <LogList lines={q.data} />
    </Modal>
  );
}

/** Where a run with verification is: Compare › Copy › Verify. */
function Steps({ r, verify }: { r: Run; verify: "off" | "quick" | "full" }) {
  if (r.mode !== "run" || verify === "off") return null;      // a check on its own has one step
  const at = r.phase === "comparing" ? 0 : r.phase === "copying" ? 1 : 2;
  return (
    <div className="mb-2 flex items-center gap-1.5 [overflow-wrap:anywhere] text-xs">
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
