import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Search, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { ago, clock, cx, date } from "../lib/format";
import { JobDialog } from "../components/jobs";
import { Button, Card, Empty, Input, PageHeader, PageLoader, Select } from "../components/ui";

type Entry = {
  kind: "talon" | "system";
  ts: number;
  level: "info" | "warning" | "error";
  message: string;
  user?: string;
  category?: string;
  job?: string;
  source?: string;
  program?: string;
};
type Page = {
  items: Entry[];
  total: number | null;
  more: boolean;
  offset: number;
  limit: number;
  categories: { id: string; label: string }[];
  sources: { id: string; label: string }[];
};
const PER_PAGE = [10, 25, 50, 100];

/** "all", "talon:" or "talon:<category>", "system:" or "system:<source>" */
function parseShow(v: string): Record<string, string> {
  if (v === "all") return { source: "all" };
  const [src, sub] = v.split(":");
  return src === "system" ? { source: "system", system: sub ?? "" } : { source: "talon", category: sub ?? "" };
}

/** Everything that happens: Talon's own activity and the system logs, in one list. */
/** When an event happened: the time today (with seconds), else the date and time. */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? clock(ts, true) : `${date(ts)} ${clock(ts, true)}`;
}

export default function ActivityPage() {
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState(() => (new URLSearchParams(location.search).get("show") ?? "all"));
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [job, setJob] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [show, level, q, perPage]);
  const act = useQuery({
    queryKey: ["activity", page, perPage, show, level, q],
    queryFn: () => api.get<Page>(`/activity?${new URLSearchParams({ offset: String(page * perPage), limit: String(perPage), level, q, ...parseShow(show) })}`),
    refetchInterval: 10000,
    placeholderData: (prev) => prev,
  });
  if (!act.data) return <PageLoader />;
  const d = act.data;
  const filtered = show !== "all" || !!level || !!q;
  const catLabel = (id?: string) => d.categories.find((c) => c.id === id)?.label ?? id ?? "";
  const srcLabel = (id?: string) => d.sources.find((s) => s.id === id)?.label ?? "";
  const key = (e: Entry, i: number) => `${e.ts}-${i}`;

  return (
    <>
      <PageHeader
        title="Activity"
        description={d.total != null ? `${d.total.toLocaleString()} event${d.total === 1 ? "" : "s"}${filtered ? " found" : ""}, newest first` : "Talon and the system, newest first"}
      />
      <Card>
        <div className="grid gap-2 border-b border-zinc-100 p-4 sm:grid-cols-[1.2fr_1fr_1.4fr] dark:border-white/5">
          <Select
            value={show}
            onChange={(e) => {
              setShow(e.target.value);
              history.replaceState(null, "", e.target.value === "all" ? "/activity" : `/activity?show=${encodeURIComponent(e.target.value)}`);
            }}
            aria-label="Show"
          >
            <option value="all">Everything</option>
            <optgroup label="Talon">
              <option value="talon:">All Talon activity</option>
              {d.categories.map((c) => (
                <option key={c.id} value={`talon:${c.id}`}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="System logs">
              <option value="system:">All system logs</option>
              {d.sources.map((s) => (
                <option key={s.id} value={`system:${s.id}`}>
                  {s.label}
                </option>
              ))}
            </optgroup>
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
        {d.items.length === 0 ? (
          <Empty icon={<Info className="size-6" />} title={filtered ? "Nothing found" : "Nothing yet"} text={filtered ? "Try another choice or search." : undefined} />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {d.items.map((e, i) => {
              const k = key(e, i);
              const who =
                e.kind === "talon"
                  ? `${e.user} · ${catLabel(e.category)}`
                  : `System · ${srcLabel(e.source) || e.program}${srcLabel(e.source) && e.program && srcLabel(e.source).toLowerCase() !== e.program ? ` (${e.program})` : ""}`;
              return (
                <li
                  key={k}
                  className="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-2.5 hover:bg-zinc-50 sm:grid-cols-[1rem_minmax(0,1fr)_13rem_9.5rem] sm:items-center dark:hover:bg-white/[0.02]"
                  onClick={() => setOpen(open === k ? null : k)}
                  aria-expanded={open === k}
                >
                  {e.level === "error" ? (
                    <XCircle className="mt-0.5 size-4 text-rose-500 sm:mt-0" />
                  ) : e.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 text-amber-500 sm:mt-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 text-emerald-500 sm:mt-0" />
                  )}
                  <div className={cx("min-w-0 text-[13px]", open === k ? "break-words whitespace-normal" : "truncate")} title={e.message}>
                    {e.message}
                  </div>
                  <div className="col-start-2 truncate text-xs text-zinc-500 sm:col-start-auto" title={who}>
                    {who}
                    <span className="sm:hidden"> · {when(e.ts)}</span>
                    {e.job && (
                      <>
                        {" · "}
                        <button
                          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setJob(e.job!);
                          }}
                        >
                          Details
                        </button>
                      </>
                    )}
                  </div>
                  <div className="tabular hidden text-right text-xs text-zinc-500 sm:block" title={ago(e.ts)}>
                    {when(e.ts)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(page > 0 || d.more) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-white/5">
            <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-zinc-500">
              Per page
              <Select value={String(perPage)} onChange={(e) => setPerPage(Number(e.target.value))} className="text-[13px]" style={{ width: "5.5rem" }}>
                {PER_PAGE.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </label>
            <div className="flex items-center gap-3">
              {d.total != null && (
                <span className="tabular text-[13px] text-zinc-500">
                  {page * perPage + 1}–{Math.min((page + 1) * perPage, d.total)} of {d.total}
                </span>
              )}
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
      <JobDialog jobId={job} onClose={() => setJob(null)} />
    </>
  );
}
