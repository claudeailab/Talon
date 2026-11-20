import { useId } from "react";
import { cx } from "../lib/format";

/** Smooth area chart for 1-2 series, scaled to the series maximum. */
export function AreaChart({
  series,
  height = 64,
  max,
  className,
}: {
  series: { values: number[]; color: string }[];
  height?: number;
  max?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const w = 300;
  const len = Math.max(...series.map((s) => s.values.length), 2);
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values)) * 1.15;
  const path = (vals: number[]) => {
    const pts = vals.map((v, i) => [((i + (len - vals.length)) / (len - 1)) * w, height - (v / top) * (height - 2) - 1]);
    if (pts.length < 2) return "";
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx1 = x0 + (x1 - x0) / 2;
      d += ` C${cx1},${y0} ${cx1},${y1} ${x1},${y1}`;
    }
    return d;
  };
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx("w-full overflow-visible", className)} style={{ height }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {series.map((s, i) => {
        const d = path(s.values);
        if (!d) return null;
        const startX = ((len - s.values.length) / (len - 1)) * w;
        return (
          <g key={i}>
            <path d={`${d} L${w},${height} L${startX},${height} Z`} fill={`url(#${id}-${i})`} />
            <path d={d} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}

/** Circular gauge (0..100). */
export function Ring({
  value,
  size = 64,
  stroke = 7,
  color = "url(#ring-grad)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-zinc-200/80 dark:stroke-white/[0.08]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Horizontal stacked bar used by the RAID wizard (usable / redundancy / unused). */
export function CapacityBar({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-white/[0.08]">
      {parts.map((p, i) =>
        p.value > 0 ? (
          <div key={i} title={p.label} className={cx("h-full transition-all duration-500", p.className)} style={{ width: `${(p.value / total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}
