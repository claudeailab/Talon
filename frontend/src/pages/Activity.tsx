import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, ListChecks, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { ago, dateTime } from "../lib/format";
import type { Activity, Job } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { Card, CardHeader, Empty, PageHeader, PageLoader } from "../components/ui";

export default function ActivityPage() {
  const act = useQuery({ queryKey: ["activity"], queryFn: () => api.get<Activity[]>("/activity"), refetchInterval: 10000 });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs"), refetchInterval: 3000 });
  const [job, setJob] = useState<string | null>(null);
  if (!act.data || !jobs.data) return <PageLoader />;
  return (
    <>
      <PageHeader title="Activity" description="Administrative actions and background tasks." />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Activity log" subtitle={`${act.data.length} recent events`} />
          {act.data.length === 0 ? (
            <Empty icon={<Info className="size-6" />} title="Nothing yet" />
          ) : (
            <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
              {act.data.map((a, i) => (
                <li key={i} className="flex items-start gap-3 py-3">
                  {a.level === "error" ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  ) : a.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] break-words">{a.message}</div>
                    <div className="text-xs text-zinc-500">
                      {a.user} · <span title={dateTime(a.ts)}>{ago(a.ts)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
