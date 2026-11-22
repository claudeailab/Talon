import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { bytes, clock, cx, dateTime, rate, shortDate } from "../lib/format";
import { Modal, PageLoader, Segmented } from "./ui";

export type HistoryMetric = "cpu" | "mem" | "net" | "disk" | "storage";
type Range = "1h" | "24h" | "7d" | "30d" | "1y";
type Pt = { ts: number } & Record<string, number>;
type Forecast = { per_month: number; full_in_days: number | null } | null;
type Hist = { range: Range; step: number; points: Pt[]; disks: string[]; volumes: Record<string, { size: number; forecast: Forecast }> };
type Line = { key: string; label: string; color: string; area?: boolean };

const RANGES: { value: Range; label: string }[] = [
  { value: "1h", label: "1 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "1y", label: "1 year" },
];
const DISK_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];
const TITLES: Record<HistoryMetric, string> = { cpu: "CPU", mem: "Memory", net: "Network", disk: "Disk Activity", storage: "Used Space" };

const pctFmt = (v: number) => (v === 0 ? "0%" : `${v.toFixed(v < 10 ? 1 : 0)}%`);
const tempFmt = (v: number) => `${v.toFixed(0)} °C`;

/** Dashboard → tap a card: the history of that metric over 1 hour to 1 year. */
export function HistoryModal({ metric, onClose }: { metric: HistoryMetric; onClose: () => void }) {
  const [range, setRange] = useState<Range>(metric === "storage" ? "30d" : "24h");
  const [vol, setVol] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["history", range],
    queryFn: () => api.get<Hist>(`/history?range=${range}`),
    refetchInterval: range === "1h" ? 30000 : 300000,
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const label = (ts: number) => (range === "1h" || range === "24h" ? clock(ts) : shortDate(ts));

  return (
    <Modal open onClose={onClose} size="lg" title={TITLES[metric]} description={d ? summary(metric, d, vol) : undefined}>
      <div className="mb-4 overflow-x-auto [scrollbar-width:none]">
        <Segmented size="sm" value={range} onChange={setRange} options={RANGES} />
      </div>
      {!d ? (
        <PageLoader />
      ) : d.points.length < 2 ? (
        <p className="py-10 text-center text-sm text-zinc-500">Not enough history yet. It builds up while the NAS runs.</p>
      ) : (
        <Body metric={metric} d={d} label={label} vol={vol} setVol={setVol} />
      )}
    </Modal>
  );
}

function Body({ metric, d, label, vol, setVol }: { metric: HistoryMetric; d: Hist; label: (ts: number) => string; vol: string | null; setVol: (v: string) => void }) {
  const p = d.points;
  if (metric === "cpu")
    return (
      <>
        <Chart points={p} step={d.step} label={label} max={100} fmt={pctFmt} lines={[{ key: "cpu", label: "Average", color: "#8b5cf6", area: true }]} />
        <Stats items={[["Average", pctFmt(avg(p, "cpu"))], ["Peak", peakText(p, "cpu^", pctFmt)], ["Temperature peak", has(p, "temp^") ? peakText(p, "temp^", tempFmt) : "—"]]} />
      </>
    );
  if (metric === "mem")
    return (
      <>
        <Chart points={p} step={d.step} label={label} max={100} fmt={pctFmt} lines={[{ key: "mem", label: "Used", color: "#a855f7", area: true }]} />
        <Stats items={[["Average", pctFmt(avg(p, "mem"))], ["Highest", peakText(p, "mem", pctFmt)]]} />
      </>
    );
  if (metric === "net")
    return (
      <>
        <Chart points={p} step={d.step} label={label} fmt={rate} lines={[{ key: "rx", label: "In", color: "#0ea5e9", area: true }, { key: "tx", label: "Out", color: "#10b981", area: true }]} />
        <Stats items={[["Received", bytes(total(p, "rx", d.step))], ["Sent", bytes(total(p, "tx", d.step))], ["Busiest", peakText(p, "rx", rate)]]} />
      </>
    );
  if (metric === "disk")
    return (
      <>
        <Chart points={p} step={d.step} label={label} fmt={rate} lines={[{ key: "read", label: "Read", color: "#f59e0b", area: true }, { key: "write", label: "Write", color: "#ec4899", area: true }]} />
        <Stats items={[["Read", bytes(total(p, "read", d.step))], ["Written", bytes(total(p, "write", d.step))]]} />
        {d.disks.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-sm font-semibold">Disk temperatures</div>
            <Chart points={p} step={d.step} label={label} fmt={tempFmt} fromMin lines={d.disks.map((n, i) => ({ key: `disk:${n}`, label: n, color: DISK_COLORS[i % DISK_COLORS.length] }))} />
            <Stats items={d.disks.map((n) => [n, `peak ${has(p, `disk:${n}^`) ? tempFmt(max(p, `disk:${n}^`)) : "—"}`])} />
          </div>
        )}
      </>
    );
  // storage
  const names = Object.keys(d.volumes);
  if (!names.length) return <p className="py-10 text-center text-sm text-zinc-500">No volumes yet.</p>;
  const v = vol && d.volumes[vol] ? vol : names[0];
  const info = d.volumes[v];
  const f = info.forecast;
  return (
    <>
      {names.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setVol(n)}
              className={cx(
                "rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset",
                n === v ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30" : "text-zinc-600 ring-zinc-200 dark:text-zinc-300 dark:ring-white/10",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <Chart points={p} step={d.step} label={label} max={info.size} fmt={(x) => bytes(x)} lines={[{ key: `vol:${v}`, label: "Used", color: "#7c3aed", area: true }]} />
      <Stats
        items={[
          ["Used", `${bytes(last(p, `vol:${v}`))} of ${bytes(info.size)}`],
          ["Growth", f ? `${f.per_month >= 0 ? "+" : "−"}${bytes(Math.abs(f.per_month))} a month` : "—"],
          ["Full in", !f ? "Not enough history" : f.full_in_days == null ? "Not growing" : fullIn(f.full_in_days)],
        ]}
      />
    </>
  );
}

function summary(metric: HistoryMetric, d: Hist, vol: string | null): string {
  const p = d.points;
  if (p.length < 2) return "";
  if (metric === "cpu") return `Average ${pctFmt(avg(p, "cpu"))} · peak ${pctFmt(max(p, "cpu^"))}`;
  if (metric === "mem") return `Average ${pctFmt(avg(p, "mem"))}`;
  if (metric === "net") return `Average in ${rate(avg(p, "rx"))} · out ${rate(avg(p, "tx"))}`;
  if (metric === "disk") return `Average read ${rate(avg(p, "read"))} · write ${rate(avg(p, "write"))}`;
  const names = Object.keys(d.volumes);
  const v = vol && d.volumes[vol] ? vol : names[0];
  return v ? v : "";
}

function fullIn(days: number): string {
  if (days < 1) return "Less than a day";
  if (days < 60) return `About ${Math.round(days)} days`;
  if (days < 730) return `About ${Math.round(days / 30)} months`;
  return `About ${Math.round(days / 365)} years`;
}

const vals = (p: Pt[], k: string) => p.map((x) => x[k]).filter((v) => typeof v === "number");
const has = (p: Pt[], k: string) => vals(p, k).length > 0;
const avg = (p: Pt[], k: string) => {
  const v = vals(p, k);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
const max = (p: Pt[], k: string) => Math.max(0, ...vals(p, k));
const last = (p: Pt[], k: string) => {
  const v = vals(p, k);
  return v.length ? v[v.length - 1] : 0;
};
const total = (p: Pt[], k: string, step: number) => vals(p, k).reduce((a, b) => a + b * step, 0);
function peakText(p: Pt[], k: string, fmt: (v: number) => string): string {
  let best: Pt | null = null;
  for (const x of p) if (typeof x[k] === "number" && (!best || x[k] > best[k])) best = x;
  return best ? `${fmt(best[k])} · ${dateTime(best.ts)}` : "—";
}

function Stats({ items }: { items: [string, string][] | string[][] }) {
  return (
    // one row of up to three; more wrap in rows of three
    <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0, 1fr))` }}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-xs text-zinc-500">{k}</div>
          {(() => {
            // "100% · 21-11-2026 18:40": the value, then when, on its own smaller line
            const [main, ...rest] = v.split(" · ");
            return (
              <>
                <div className="tabular text-[13px] font-semibold break-words">{main}</div>
                {rest.length > 0 && <div className="tabular text-[11.5px] text-zinc-500">{rest.join(" · ")}</div>}
              </>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

/** Line chart with time and value labels; gaps where the NAS was off. */
function Chart({
  points,
  step,
  lines,
  label,
  max: top,
  fmt,
  fromMin,
}: {
  points: Pt[];
  step: number;
  lines: Line[];
  label: (ts: number) => string;
  max?: number;
  fmt: (v: number) => string;
  fromMin?: boolean; // start the scale near the lowest value (temperatures), not at 0
}) {
  const W = 600;
  const H = 180;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const span = Math.max(t1 - t0, 1);
  const all = lines.flatMap((l) => vals(points, l.key));
  const lo = fromMin ? Math.max(0, Math.floor((Math.min(...all) - 3) / 5) * 5) : 0;
  const hi = top ?? (fromMin ? Math.ceil((Math.max(...all) + 3) / 5) * 5 : Math.max(1, ...all) * 1.1);
  const x = (ts: number) => ((ts - t0) / span) * W;
  const y = (v: number) => H - ((v - lo) / Math.max(hi - lo, 1e-9)) * (H - 4) - 2;
  // one path per stretch without gaps (the NAS was off, or the value was missing)
  const paths = (key: string) => {
    const segs: { d: string; x0: number }[] = [];
    let cur: { d: string; x0: number } | null = null;
    let prev: number | null = null;
    for (const p of points) {
      const v = p[key];
      if (typeof v !== "number") continue;
      const px = x(p.ts).toFixed(1);
      const py = y(v).toFixed(1);
      if (!cur || (prev != null && p.ts - prev > step * 2.5)) {
        if (cur) segs.push(cur);
        cur = { d: `M${px},${py}`, x0: Number(px) };
      } else {
        cur.d += ` L${px},${py}`;
      }
      prev = p.ts;
    }
    if (cur) segs.push(cur);
    return segs;
  };
  const ticks = [0, 1, 2, 3].map((i) => t0 + (span * i) / 3);
  return (
    <div>
      <div className="flex gap-2">
        <div className="tabular flex w-14 shrink-0 flex-col justify-between py-0.5 text-right text-[10.5px] text-zinc-400" style={{ height: H }}>
          <span>{fmt(hi)}</span>
          <span>{fmt((hi + lo) / 2)}</span>
          <span>{fmt(lo)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
            {[2, H / 2, H - 2].map((gy) => (
              <line key={gy} x1="0" x2={W} y1={gy} y2={gy} stroke="currentColor" className="text-zinc-100 dark:text-white/5" vectorEffect="non-scaling-stroke" />
            ))}
            {lines.map((l) =>
              paths(l.key).map((s, i) => (
                <g key={l.key + i}>
                  {l.area && <path d={`${s.d} V${H} H${s.x0} Z`} fill={l.color} opacity="0.12" />}
                  <path d={s.d} fill="none" stroke={l.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </g>
              )),
            )}
          </svg>
          <div className="tabular mt-1 flex justify-between text-[10.5px] text-zinc-400">
            {ticks.map((t) => (
              <span key={t}>{label(t)}</span>
            ))}
          </div>
        </div>
      </div>
      {lines.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-16 text-xs text-zinc-500">
          {lines.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
