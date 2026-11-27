import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useFollow } from "../lib/hooks";
import type { Job } from "../lib/types";
import { Button, Callout, Modal, Progress } from "./ui";

/** A job's log: the steps it declared ("STEPS [...]"), the running one ("STEP n detail") and the rest (Details). */
export function parseJob(log: string[]) {
  let labels: string[] = [];
  let step = 0;
  let detail = "";
  let result = "";
  const rest: string[] = [];
  for (const l of log) {
    if (l.startsWith("STEPS ")) {
      try {
        labels = JSON.parse(l.slice(6));
      } catch {
        labels = [];
      }
    } else if (/^STEP \d+/.test(l)) {
      const m = /^STEP (\d+)\s*(.*)$/.exec(l)!;
      step = Number(m[1]);
      detail = m[2];
    } else if (l.startsWith("RESULT ")) result = l.slice(7);
    else if (!l.startsWith("== ")) rest.push(l);
  }
  return { labels, step, detail, result, rest };
}

/** The steps of a job with a progress bar, and its output folded away under Details. */
export function JobProgress({ job, hint }: { job: Job | undefined; hint?: string }) {
  const [open, setOpen] = useState(false);
  const { labels, step, detail, result, rest } = parseJob(job?.log ?? []);
  const status = job?.status ?? "queued";
  const failed = status === "error";
  const ok = status === "success";
  const cur = Math.max(1, step);
  const percent = ok ? 100 : labels.length ? ((cur - 1) / labels.length) * 100 + 100 / labels.length / 2 : 0;
  const list = labels.length ? labels : [job?.title ?? "Working"];

  return (
    <div>
      {failed && job?.error && (
        <Callout tone="danger" className="mb-3">
          {job.error}
        </Callout>
      )}
      <ol className="space-y-2.5">
        {list.map((label, i) => {
          const n = i + 1;
          const isFail = failed && n === cur;
          const done = ok || (!isFail && n < cur);
          const active = !ok && !failed && n === cur;
          return (
            <li key={i} className="flex items-start gap-3 text-[13.5px]">
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-emerald-500 text-white",
                  active && "bg-brand-600 text-white",
                  isFail && "bg-rose-500 text-white",
                  !done && !active && !isFail && "bg-zinc-100 text-zinc-400 dark:bg-white/5",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : active ? <Loader2 className="size-3.5 animate-spin" /> : isFail ? "!" : n}
              </span>
              <span className="min-w-0 pt-0.5">
                <span className={cx("block break-words", active || isFail ? "font-semibold" : done ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400")}>{label}</span>
                {active && detail && <span className="block text-xs text-zinc-500">{detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {!failed &&
        (labels.length || ok ? (
          <Progress value={percent} className="mt-4 h-2" />
        ) : (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/5">
            <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brand-500 to-violet-500" />
          </div>
        ))}
      {ok && result && <p className="mt-3 text-[13px] text-zinc-600 dark:text-zinc-300">{result}</p>}
      <div className="mt-3 text-xs text-zinc-500">
        {hint && !ok && !failed && <>{hint} </>}
        {rest.length > 0 && (
          <button type="button" className="inline-flex items-center gap-0.5 font-medium hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setOpen(!open)}>
            Details <ChevronDown className={cx("size-3.5 transition", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && <Details text={rest.join("\n")} />}
    </div>
  );
}

/** The commands and their output, scrolled to the newest line. */
function Details({ text }: { text: string }) {
  const follow = useFollow<HTMLPreElement>(text);
  return (
        <pre {...follow} className="mt-2 max-h-56 overflow-auto rounded-xl bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-600 ring-1 ring-zinc-200 [overflow-wrap:anywhere] dark:bg-white/[0.03] dark:text-zinc-300 dark:ring-white/10">
          {text}
        </pre>
  );
}

/** A background storage job (create RAID, create volume, …): its steps as they run, then the result. */
export function JobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ["success", "error"].includes(q.state.data.status) ? false : 800),
  });
  const done = data && ["success", "error"].includes(data.status);
  // when a job ends, refresh everything it may have changed (disks, RAID, volumes, ...)
  const qc = useQueryClient();
  useEffect(() => {
    if (done) for (const k of ["disks", "raid", "raid-options", "volumes", "volume-sources", "shares", "files", "dashboard", "jobs"]) qc.invalidateQueries({ queryKey: [k] });
  }, [done, jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal
      open={!!jobId}
      onClose={onClose}
      title={data?.title ?? "Working…"}
      description={data?.status === "success" ? "Done" : data?.status === "error" ? "Something went wrong" : "You can close this window; the task keeps running."}
      icon={
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/5">
          {!done && <Loader2 className="size-5 animate-spin text-brand-500" />}
          {data?.status === "success" && <CheckCircle2 className="size-5 text-emerald-500" />}
          {data?.status === "error" && <XCircle className="size-5 text-rose-500" />}
        </div>
      }
      footer={
        <Button variant={done ? "primary" : "secondary"} onClick={onClose}>
          {done ? "Done" : "Run in background"}
        </Button>
      }
    >
      <JobProgress job={data} />
    </Modal>
  );
}
