import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Clock, Copy, FileText, MoreHorizontal, Pause, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { FormHint } from "../components/rows";
import { ago, bytes, cx, dateTime, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { ScheduledTask, TaskRun, TaskSchedule } from "../lib/types";
import { Badge, Button, Card, ConfirmDialog, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, PageLoader, Progress, Select, TimeInput } from "../components/ui";
import { ToggleBox } from "./OneDrive";

type Data = { tasks: ScheduledTask[]; run_as: string[] };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SCHEDULES = [
  { value: "manual", label: "Manually" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "startup", label: "At startup" },
  { value: "cron", label: "Custom (cron)" },
];
const TIMEOUTS = [
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 360, label: "6 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "24 hours" },
  { value: 0, label: "No limit" },
];

/** "41 s", "4 min", "2 h 5 min" */
function took(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function firstLine(script: string): string {
  const lines = script.split("\n").filter((l) => l.trim());
  return lines.length > 1 ? `Script · ${lines.length} lines` : (lines[0] ?? "");
}

export default function ScheduledPage() {
  const q = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => api.get<Data>("/scheduled"),
    refetchInterval: (query) => (query.state.data?.tasks.some((t) => t.running) ? 2000 : 10000),
  });
  const [edit, setEdit] = useState<ScheduledTask | "new" | null>(null);
  const [copyOf, setCopyOf] = useState<ScheduledTask | null>(null);
  const [outputOf, setOutputOf] = useState<ScheduledTask | null>(null);
  const [del, setDel] = useState<ScheduledTask | null>(null);
  const run = useAction((id: string) => api.post(`/scheduled/${id}/run`), { success: "Task started", invalidate: ["scheduled"] });
  const stop = useAction((id: string) => api.post(`/scheduled/${id}/stop`), { success: "Task stopped", invalidate: ["scheduled"] });
  const pause = useAction((v: { id: string; on: boolean }) => api.post(`/scheduled/${v.id}/${v.on ? "resume" : "pause"}`), {
    success: (_r, v) => (v.on ? "Task resumed" : "Task paused"),
    invalidate: ["scheduled"],
  });
  const remove = useAction((id: string) => api.del(`/scheduled/${id}`), {
    success: "Task deleted",
    invalidate: ["scheduled"],
    onSuccess: () => setDel(null),
  });

  if (!q.data) return <PageLoader />;
  const { tasks, run_as } = q.data;
  const newButton = (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>
      New task
    </Button>
  );

  return (
    <>
      <PageHeader title="Scheduled" description="Run scripts on a schedule" actions={tasks.length > 0 && newButton} />
      {tasks.length === 0 ? (
        <Card>
          <Empty icon={<Clock className="size-6" />} title="No scheduled tasks" text="Run a command or script on a schedule, or when the NAS starts." action={newButton} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                  <th className="px-5 py-3">Task</th>
                  <th className="hidden px-3 py-3 md:table-cell">Run as</th>
                  <th className="hidden px-3 py-3 lg:table-cell">Schedule</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Last run</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Status</th>
                  <th className="w-24 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="max-w-0 px-5 py-3.5 sm:max-w-none">
                      <div className="[overflow-wrap:anywhere] font-medium">{t.name}</div>
                      <div className="max-w-md [overflow-wrap:anywhere] font-mono text-xs text-zinc-500">{firstLine(t.script)}</div>
                      {/* phones: status, schedule and last run under the name */}
                      <div className="mt-1.5 flex min-w-0 items-center gap-2 sm:hidden">
                        <TaskStatus t={t} />
                        <span className="[overflow-wrap:anywhere] text-xs text-zinc-500">{t.schedule_label}</span>
                      </div>
                    </td>
                    <td className="hidden px-3 md:table-cell">
                      <Badge>{t.run_as}</Badge>
                    </td>
                    <td className="hidden px-3 whitespace-nowrap text-zinc-600 lg:table-cell dark:text-zinc-400">{t.schedule_label}</td>
                    <td className="hidden px-3 whitespace-nowrap text-zinc-600 sm:table-cell dark:text-zinc-400">
                      {t.running
                        ? `Running · ${took(Date.now() / 1000 - t.running.started)}`
                        : t.last
                          ? `${ago(t.last.started)} · ${took(t.last.finished - t.last.started)}`
                          : "Never"}
                    </td>
                    <td className="hidden px-3 sm:table-cell">
                      <TaskStatus t={t} />
                    </td>
                    <td className="px-3">
                      <div className="flex items-center justify-end">
                        {t.running ? (
                          <IconButton label="Stop" onClick={() => stop.mutate(t.id)}>
                            <Square className="size-4" />
                          </IconButton>
                        ) : (
                          <IconButton label="Run now" onClick={() => run.mutate(t.id)}>
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
                          <MenuItem icon={<Pencil />} onClick={() => setEdit(t)}>
                            Edit
                          </MenuItem>
                          <MenuItem icon={<FileText />} onClick={() => setOutputOf(t)}>
                            View output
                          </MenuItem>
                          <MenuItem icon={t.enabled ? <Pause /> : <Play />} onClick={() => pause.mutate({ id: t.id, on: !t.enabled })}>
                            {t.enabled ? "Pause" : "Resume"}
                          </MenuItem>
                          <MenuItem icon={<Copy />} onClick={() => setCopyOf(t)}>
                            Duplicate
                          </MenuItem>
                          <MenuItem icon={<Trash2 />} danger onClick={() => setDel(t)}>
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
      )}

      {(edit || copyOf) && (
        <TaskDialog
          task={edit && edit !== "new" ? edit : null}
          copy={copyOf}
          runAs={run_as}
          onClose={() => {
            setEdit(null);
            setCopyOf(null);
          }}
        />
      )}
      {outputOf && <OutputDialog task={outputOf} onClose={() => setOutputOf(null)} />}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.id)}
        loading={remove.isPending}
        danger
        title={`Delete task ${del?.name}?`}
        confirmText="Delete task"
        message="The task and its output history are removed. Files it created are not touched."
      />
    </>
  );
}

function TaskStatus({ t }: { t: ScheduledTask }) {
  if (t.running)
    return (
      <div className="w-28">
        <Badge tone="blue" dot>
          Running{t.running.percent != null ? ` ${Math.floor(t.running.percent)}%` : ""}
        </Badge>
        <Progress value={t.running.percent} tone="blue" className="mt-1.5 h-1" />
      </div>
    );
  if (!t.enabled) return <Badge dot>Paused</Badge>;
  if (!t.last) return <Badge dot>Not run yet</Badge>;
  if (t.last.status === "success") return <Badge tone="green" dot>Succeeded</Badge>;
  if (t.last.status === "cancelled") return <Badge tone="amber" dot>Stopped</Badge>;
  return <Badge tone="red" dot>Failed (exit {t.last.exit_code})</Badge>;
}

/* ---------------------------------------------------------------- new / edit */

type Form = {
  name: string;
  script: string;
  run_as: string;
  timeout: number;
  schedule: string; // a value of SCHEDULES
  time: string;
  weekday: number;
  day: number;
  cron: string;
  notify: boolean;
  skip_if_running: boolean;
};

function toForm(t: ScheduledTask | null, copy: boolean): Form {
  const s = t?.schedule ?? ({ kind: "daily", time: "03:00" } as TaskSchedule);
  return {
    name: t ? (copy ? `${t.name} (copy)` : t.name) : "",
    script: t?.script ?? "",
    run_as: t?.run_as ?? "root",
    timeout: t?.timeout ?? 60,
    schedule: s.kind === "interval" ? String(s.minutes) : s.kind,
    time: "time" in s ? s.time : "03:00",
    weekday: s.kind === "weekly" ? s.weekday : 6,
    day: s.kind === "monthly" ? s.day : 1,
    cron: s.kind === "cron" ? s.cron : "",
    notify: t?.notify ?? true,
    skip_if_running: t?.skip_if_running ?? true,
  };
}

function toBody(f: Form) {
  const k = f.schedule;
  const schedule: TaskSchedule =
    k === "manual" || k === "startup"
      ? { kind: k }
      : k === "daily"
        ? { kind: "daily", time: f.time }
        : k === "weekly"
          ? { kind: "weekly", weekday: f.weekday, time: f.time }
          : k === "monthly"
            ? { kind: "monthly", day: f.day, time: f.time }
            : k === "cron"
              ? { kind: "cron", cron: f.cron }
              : { kind: "interval", minutes: Number(k) };
  return { name: f.name.trim(), script: f.script, run_as: f.run_as, timeout: f.timeout, schedule, notify: f.notify, skip_if_running: f.skip_if_running };
}

function TaskDialog({ task, copy, runAs, onClose }: { task: ScheduledTask | null; copy: ScheduledTask | null; runAs: string[]; onClose: () => void }) {
  const initial = toForm(task ?? copy, !!copy);
  const [f, setF] = useState<Form>(initial);
  const [test, setTest] = useState<{ exit_code: number; output: string; seconds: number } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(() => (task ? api.put(`/scheduled/${task.id}`, toBody(f)) : api.post("/scheduled", toBody(f))), {
    success: task ? "Task saved" : "Task created",
    invalidate: ["scheduled"],
    onSuccess: onClose,
  });
  const testRun = useAction(() => api.post<{ exit_code: number; output: string; seconds: number }>("/scheduled/test", toBody(f)), {
    onSuccess: (r) => setTest(r),
  });
  useEffect(() => setTest(null), [f.script, f.run_as]);
  const ready = !!f.name.trim() && !!f.script.trim() && (f.schedule !== "cron" || f.cron.trim().split(/\s+/).length === 5);
  const changed = !task || !sameValue(f, initial);
  const missing = !f.name.trim()
    ? "Enter a name"
    : !f.script.trim()
      ? "Enter the commands to run"
      : f.schedule === "cron" && f.cron.trim().split(/\s+/).length !== 5
        ? "The cron expression needs 5 fields"
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={task ? `Edit ${task.name}` : "New task"}
      description="Runs on this NAS with the permissions of the chosen account"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button icon={<Play className="size-4" />} loading={testRun.isPending} disabled={!f.script.trim()} onClick={() => testRun.mutate()}>
            Test run
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <FormHint text={changed ? missing : null} />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!ready || !changed} loading={save.isPending} onClick={() => save.mutate()}>
              {task ? "Save" : "Create task"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Task name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Clean old downloads" autoFocus={!task} />
          </Field>
          <Field label="Run as">
            <Select value={f.run_as} onChange={(e) => set("run_as", e.target.value)}>
              {runAs.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="What to run" hint="Runs with bash, one command per line. Volumes are at /srv/nas/<volume>.">
          <textarea
            value={f.script}
            onChange={(e) => set("script", e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder={"find /srv/nas/tank/Downloads -mtime +30 -delete"}
            className="block w-full resize-y rounded-xl border-0 bg-zinc-950 px-4 py-3 font-mono text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </Field>

        {test && (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[13px]">
              <span className="font-medium">Test run</span>
              <Badge tone={test.exit_code === 0 ? "green" : "red"} dot>
                {test.exit_code === 0 ? "Succeeded" : `Failed (exit ${test.exit_code})`}
              </Badge>
              <span className="text-zinc-500">{took(test.seconds)}</span>
            </div>
            <pre className="max-h-28 overflow-auto rounded-xl bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]">
              {test.output || "No output"}
            </pre>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Schedule">
            <Select value={f.schedule} onChange={(e) => set("schedule", e.target.value)}>
              {SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <ScheduleDetail f={f} set={set} />
          <Field label="Stop after">
            <Select value={f.timeout} onChange={(e) => set("timeout", Number(e.target.value))}>
              {TIMEOUTS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ToggleBox title="Email me if it fails" text="Uses the Notifications settings" checked={f.notify} onChange={(v) => set("notify", v)} />
          <ToggleBox title="Skip if still running" text="No overlapping runs" checked={f.skip_if_running} onChange={(v) => set("skip_if_running", v)} />
        </div>
      </div>
    </Modal>
  );
}

function ScheduleDetail({ f, set }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
  const input = <TimeInput value={f.time} onChange={(v) => set("time", v)} />;
  const time = <div className="w-[6rem] shrink-0">{input}</div>;
  if (f.schedule === "daily") return <Field label="At">{input}</Field>;
  if (f.schedule === "weekly")
    return (
      <Field label="On">
        <div className="flex gap-2">
          <Select value={f.weekday} onChange={(e) => set("weekday", Number(e.target.value))} className="min-w-0 flex-1">
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
          {time}
        </div>
      </Field>
    );
  if (f.schedule === "monthly")
    return (
      <Field label="On day">
        <div className="flex gap-2">
          <Select value={f.day} onChange={(e) => set("day", Number(e.target.value))} className="min-w-0 flex-1">
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </Select>
          {time}
        </div>
      </Field>
    );
  if (f.schedule === "cron")
    return (
      <Field label="Minute hour day month weekday">
        <Input value={f.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 3 * * *" className="font-mono" spellCheck={false} />
      </Field>
    );
  return <div className="hidden md:block" />;
}

/* ---------------------------------------------------------------- output */

function OutputDialog({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["scheduled-runs", task.id],
    queryFn: () => api.get<TaskRun[]>(`/scheduled/${task.id}/runs`),
    refetchInterval: (query) => (query.state.data?.[0]?.status === "running" ? 1500 : false),
  });
  const runs = q.data ?? [];
  const run = runs[0];            // the latest run only; earlier runs are in the activity log
  // keep the newest output in view, unless the user scrolled up to read something
  const out = useRef<HTMLUListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (out.current && follow.current) out.current.scrollTop = out.current.scrollHeight;
  }, [run?.output, run?.id]);
  return (
    <Modal open onClose={onClose} size="xl" title={task.name} description="Earlier runs are in the activity log" footer={<Button onClick={onClose}>Close</Button>}>
      {!q.data ? (
        <PageLoader />
      ) : runs.length === 0 ? (
        <div className="py-10 text-center text-sm text-zinc-500">This task has not run yet.</div>
      ) : (
        <div>
          {run && (
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-zinc-500">
                <span>Started {dateTime(run.started)} · {runLabel(run)}</span>
                <span>
                  {run.finished ? `Took ${took(run.finished - run.started)} · ` : ""}
                  {run.trigger === "manual" ? "Started by hand" : "Started by schedule"}
                </span>
              </div>
              {run.status === "running" && <RunProgress run={run} />}
              {run.status === "running" && <Activity idle={run.idle ?? 0} />}
              {run.output ? (
                <ul
                  ref={out}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  }}
                  className="max-h-[50vh] max-h-[50dvh] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-200 sm:max-h-[60vh] dark:divide-white/5 dark:ring-white/10"
                >
                  {run.output.replace(/\n$/, "").split("\n").map((line, i) => (
                    <OutputLine key={i} line={line} />
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl py-8 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:ring-white/10">No output yet</div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** The real progress when the script reports it (rsync --info=progress2, or "PROGRESS 45");
 * otherwise a moving bar with how long it has been running. Never a guessed percentage. */
function RunProgress({ run }: { run: TaskRun }) {
  const p = run.progress;
  const elapsed = Date.now() / 1000 - run.started;
  const detail = p
    ? p.source === "rsync"
      ? [p.bytes != null && `${bytes(p.bytes)} copied`, p.speed && `${bytes(p.speed)}/s`, p.eta ? `about ${took(p.eta)} left` : ""]
          .filter(Boolean)
          .join(" · ")
      : `Running for ${took(elapsed)}`
    : `Running for ${took(elapsed)}` + (run.last_took ? ` · the last run took ${took(run.last_took)}` : "");
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="shrink-0 font-medium">{p ? `Running ${Math.floor(p.percent)}%` : "Running"}</span>
        <span className="[overflow-wrap:anywhere] text-zinc-500">{detail}</span>
      </div>
      <Progress value={p ? p.percent : null} tone="blue" className="mt-1.5 h-1.5" />
    </div>
  );
}

const wait = (s: number) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

/** Whether the script is still printing, so a long wait never looks like a hang. */
function Activity({ idle }: { idle: number }) {
  const quiet = idle >= 60;
  return (
    <div className={cx("mb-2 flex items-center gap-1.5 text-xs", quiet ? "text-amber-600 dark:text-amber-400" : "text-zinc-500")}>
      <span className={cx("size-1.5 shrink-0 rounded-full", quiet ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
      <span>
        {quiet
          ? `No new output for ${wait(idle)} · the script is still running`
          : `Working · ${idle <= 3 ? "new output just now" : `new output ${idle} s ago`}`}
      </span>
    </div>
  );
}

/** One output line: "HH:MM:SS<TAB>text" (older runs: just the text). */
function OutputLine({ line }: { line: string }) {
  const m = /^(\d\d:\d\d:\d\d)\t(.*)$/.exec(line);
  const [when, text] = m ? [m[1], m[2]] : ["", line];
  return (
    <li className="flex items-baseline gap-2 px-3 py-1.5">
      {when && <span className="tabular shrink-0 text-xs text-zinc-400">{when}</span>}
      <span className="min-w-0 font-mono text-[12px] whitespace-pre-wrap text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
        {/* allow line breaks after each "/" so long paths wrap between folders */}
        {text.split("/").map((seg, j, all) => (
          <span key={j}>
            {seg}
            {j < all.length - 1 && (
              <>
                /<wbr />
              </>
            )}
          </span>
        ))}
      </span>
    </li>
  );
}

function runLabel(r: TaskRun) {
  return r.status === "running" ? "Running" : r.status === "success" ? "OK" : r.status === "cancelled" ? "Stopped" : `Exit ${r.exit_code}`;
}

