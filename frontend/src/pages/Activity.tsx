import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Search, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { ago, cx, dateTime } from "../lib/format";
import type { Activity } from "../lib/types";
import { JobDialog } from "../components/jobs";
import { Button, Card, CardHeader, Empty, Input, PageHeader, PageLoader, Select, SubTabs } from "../components/ui";

type Page = { items: Activity[]; total: number; offset: number; limit: number; categories: { id: string; label: string }[] };
const PER_PAGE = [10, 25, 50, 100];

type SysEntry = { ts: number; level: "info" | "warning" | "error"; source: string; program: string; message: string };
type SysPage = { items: SysEntry[]; offset: number; limit: number; more: boolean; sources: { id: string; label: string }[] };

export default function ActivityPage() {
  const [view, setView] = useState<"talon" | "system">(() => (new URLSearchParams(location.search).get("tab") === "system" ? "system" : "talon"));
  return (
    <>
      <PageHeader title="Activity" description="Everything that happens in Talon" />
      <SubTabs
        className="mb-4"
        value={view}
        onChange={(v) => {
          setView(v);
          history.replaceState(null, "", v === "system" ? "/activity?tab=system" : "/activity");
        }}
        tabs={[
          { value: "talon", label: "Talon" },
          { value: "system", label: "System logs" },
        ]}
      />
      {view === "talon" ? <TalonLog /> : <SystemLogs />}
    </>
  );
}

function LevelIcon({ level }: { level: string }) {
  return level === "error" ? (
    <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
  ) : level === "warning" ? (
    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
  ) : (
    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
  );
}

/** What the operating system and its services wrote to the system journal. */
function SystemLogs() {
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [source, level, q, perPage]);
  const logs = useQuery({
    queryKey: ["syslog", page, perPage, source, level, q],
    queryFn: () => api.get<SysPage>(`/syslog?${new URLSearchParams({ offset: String(page * perPage), limit: String(perPage), source, level, q })}`),
    refetchInterval: 10000,
    placeholderData: (prev) => prev,
  });
  if (!logs.data) return <PageLoader />;
  const d = logs.data;
  const label = (id: string) => d.sources.find((x) => x.id === id)?.label ?? "";
  return (
    <Card>
      <CardHeader title="System Logs" subtitle="Messages from the operating system and its services" />
      <div className="space-y-2 px-5 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {[{ id: "", label: "All" }, ...d.sources].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSource(x.id)}
              className={cx(
                "rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 transition ring-inset",
                source === x.id
                  ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30"
                  : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
            <option value="">All messages</option>
            <option value="warning">Warnings and errors</option>
            <option value="error">Errors only</option>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-9" aria-label="Search" />
          </div>
        </div>
      </div>
      {d.items.length === 0 ? (
        <Empty icon={<Info className="size-6" />} title="Nothing found" text={source || level || q ? "Try another source or search." : undefined} />
      ) : (
        <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
          {d.items.map((e, i) => (
            <li key={i} className="flex cursor-pointer items-start gap-3 py-3" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <LevelIcon level={e.level} />
              <div className="min-w-0 flex-1">
                <div className={cx("text-[13px]", open === i ? "break-words whitespace-normal" : "truncate")} title={e.message}>
                  {e.message}
                </div>
                <div className="text-xs text-zinc-500">
                  {label(e.source) || e.program}
                  {label(e.source) && e.program && label(e.source).toLowerCase() !== e.program ? ` (${e.program})` : ""} ·{" "}
                  <span title={dateTime(e.ts)}>{ago(e.ts)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(page > 0 || d.more) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-white/5">
          <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-zinc-500">
            Per page
            <Select value={String(perPage)} onChange={(e) => setPerPage(Number(e.target.value))} className="text-[13px]" style={{ width: "5.5rem" }}>
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </label>
          <div className="flex items-center gap-3">
            <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={page === 0} onClick={() => setPage(page - 1)}>
              Newer
            </Button>
            <Button size="sm" disabled={!d.more} onClick={() => setPage(page + 1)}>
              Older
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TalonLog() {
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null); // the entry shown in full
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");                 // the search, once typing pauses
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [category, level, q, perPage]);
  const act = useQuery({
    queryKey: ["activity", page, perPage, category, level, q],
    queryFn: () =>
      api.get<Page>(`/activity?${new URLSearchParams({ offset: String(page * perPage), limit: String(perPage), category, level, q })}`),
    refetchInterval: 10000,
    placeholderData: (prev) => prev,
  });
  const filtered = !!(category || level || q);
  const [job, setJob] = useState<string | null>(null);
  if (!act.data) return <PageLoader />;
  return (
    <>
      <div>
        <Card>
          <CardHeader title="Activity Log" subtitle={`${act.data.total} event${act.data.total === 1 ? "" : "s"}${filtered ? " found" : ""}`} />
          {/* filters: which kind of operation, how serious, and a text search */}
          <div className="grid gap-2 px-5 pb-3 sm:grid-cols-[1fr_1fr_1.4fr]">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Operation">
              <option value="">All operations</option>
              {act.data.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
            <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
              <option value="">All events</option>
              <option value="warning">Warnings and errors</option>
              <option value="error">Errors only</option>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-9" aria-label="Search" />
            </div>
          </div>
          {act.data.total === 0 ? (
            <Empty icon={<Info className="size-6" />} title={filtered ? "Nothing found" : "Nothing yet"} text={filtered ? "Try another operation or search." : undefined} />
          ) : (
            <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
              {act.data.items.map((a, i) => (
                <li
                  key={i}
                  className="flex cursor-pointer items-start gap-3 py-3"
                  onClick={() => setOpen((o) => (o === a.ts + a.message ? null : a.ts + a.message))}
                  aria-expanded={open === a.ts + a.message}
                >
                  <LevelIcon level={a.level} />
                  <div className="min-w-0 flex-1">
                    {/* one line; tap (or click) to read the whole message */}
                    <div
                      className={cx("text-[13px]", open === a.ts + a.message ? "break-words whitespace-normal" : "truncate")}
                      title={a.message}
                    >
                      {a.message}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {a.user} · {act.data.categories.find((c) => c.id === a.category)?.label ?? a.category} ·{" "}
                      <span title={dateTime(a.ts)}>{ago(a.ts)}</span>
                      {a.job && (
                        <>
                          {" · "}
                          <button
                            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              setJob(a.job!);
                            }}
                          >
                            Details
                          </button>
                        </>
                      )}
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
      </div>
      <JobDialog jobId={job} onClose={() => setJob(null)} />
    </>
  );
}
