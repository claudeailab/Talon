import { CheckCircle2, XCircle } from "lucide-react";

export type Check = { name: string; ok: boolean; detail: string };

/** Step-by-step result of a connection test, shown at the bottom of its card. */
export function TestResult({ checks }: { checks: Check[] }) {
  return (
    <div className="border-t border-zinc-100 px-5 py-4 dark:border-white/5">
      <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Test result</div>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-[13px]">
            {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-rose-500" />}
            <span className="shrink-0 font-medium">{c.name}</span>
            <span className="truncate text-zinc-500" title={c.detail}>
              {c.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
