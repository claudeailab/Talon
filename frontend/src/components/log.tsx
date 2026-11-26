import { useEffect, useRef } from "react";
import { cx } from "../lib/format";
import { Badge } from "./ui";

/** A run's log (OneDrive, Backup), keeping the newest line in view unless the user scrolled up to read something. */
export function LogList({ lines }: { lines: string[] | undefined }) {
  const list = useRef<HTMLUListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  if (!lines?.length) return <div className="py-8 text-center text-sm text-zinc-500">No log yet.</div>;
  return (
    <ul
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="max-h-[50vh] max-h-[50dvh] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-200 sm:max-h-[60vh] dark:divide-white/5 dark:ring-white/10"
    >
      {lines.map((line, i) => (
        <LogLine key={i} line={line} />
      ))}
    </ul>
  );
}

/** One log entry: "time<TAB>LEVEL<TAB>file<TAB>message", or any older plain line. */
function LogLine({ line }: { line: string }) {
  const parts = line.split("\t");
  if (parts.length !== 4)
    return <li className="px-3 py-2 font-mono text-[12px] text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">{line}</li>;
  const [when, level, file, msg] = parts;
  const tone = level === "ERROR" ? "red" : level === "NOTICE" || level === "WARNING" ? "amber" : level === "SUCCESS" ? "green" : null;
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline gap-2 text-[13px]">
        {when && <span className="tabular shrink-0 text-xs text-zinc-400">{when}</span>}
        {tone && (
          <Badge tone={tone} className="shrink-0">
            {level === "ERROR" ? "Error" : level === "SUCCESS" ? "OK" : "Warning"}
          </Badge>
        )}
        <span className={cx("min-w-0 font-medium break-words", tone === "red" && "text-rose-600 dark:text-rose-400")}>{msg}</span>
      </div>
      {file && (
        <div className="mt-0.5 text-[12px] text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">
          {/* allow line breaks after each "/" so long paths wrap between folders */}
          {file.split("/").map((seg, j, all) => (
            <span key={j}>
              {seg}
              {j < all.length - 1 && (
                <>
                  /<wbr />
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
