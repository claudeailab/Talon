import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, ListChecks, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { ago, cx, dateTime } from "../lib/format";
import type { Activity, Job } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { Button, Card, CardHeader, Empty, PageHeader, PageLoader, Select } from "../components/ui";

type Page = { items: Activity[]; total: number; offset: number; limit: number };
const PER_PAGE = [10, 25, 50, 100];

export default function ActivityPage() {
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null); // the entry shown in full
  const act = useQuery({
    queryKey: ["activity", page, perPage],
    queryFn: () => api.get<Page>(`/activity?offset=${page * perPage}&limit=${perPage}`),
    refetchInterval: 10000,
    placeholderData: (prev) => prev,
  });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs"), refetchInterval: 3000 });
  const [job, setJob] = useState<string | null>(null);
  if (!act.data || !jobs.data) return <PageLoader />;
  return (
    <>
      <PageHeader title="Activity" description="Administrative actions and background tasks." />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Activity Log" subtitle={`${act.data.total} event${act.data.total === 1 ? "" : "s"}`} />
          {act.data.total === 0 ? (
            <Empty icon={<Info className="size-6" />} title="Nothing yet" />
          ) : (
            <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
              {act.data.items.map((a, i) => (
                <li
                  key={i}
                  className="flex cursor-pointer items-start gap-3 py-3"
                  onClick={() => setOpen((o) => (o === a.ts + a.message ? null : a.ts + a.message))}
                  aria-expanded={open === a.ts + a.message}
                >
                  {a.level === "error" ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  ) : a.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    {/* one line; tap (or click) to read the whole message */}
                    <div
                      className={cx("text-[13px]", open === a.ts + a.message ? "break-words whitespace-normal" : "truncate")}
                      title={a.message}
                    >
                      {a.message}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {a.user} · <span title={dateTime(a.ts)}>{ago(a.ts)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {act.data.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-white/5">
              <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-zinc-500">
                Per page
                <Select
                  value={String(perPage)}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(0);
                  }}
                  className="text-[13px]"
                  style={{ width: "5.5rem" }}
                >
                  {PER_PAGE.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </label>
              <div className="flex items-center gap-3">
                <span className="tabular text-[13px] text-zinc-500">
                  {page * perPage + 1}–{Math.min((page + 1) * perPage, act.data.total)} of {act.data.total}
                </span>
                <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button size="sm" disabled={(page + 1) * perPage >= act.data.total} onClick={() => setPage(page + 1)}>
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader icon={<ListChecks className="size-4.5" />} title="Tasks" subtitle="Since the service started" />
          {jobs.data.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-zinc-500">No tasks have run.</p>
          ) : (
            <ul className="space-y-1 px-3 pb-3">
              {jobs.data.map((j) => (
                <li key={j.id}>
                  <button onClick={() => setJob(j.id)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/[0.03]">
                    {j.status === "success" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    ) : j.status === "error" ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                    ) : (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand-500" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{j.title}</div>
                      <div className="text-xs text-zinc-500">{ago(j.started)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <JobDialog jobId={job} onClose={() => setJob(null)} />
    </>
  );
}
