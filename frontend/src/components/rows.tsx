import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cx } from "../lib/format";
import { Button, Card } from "./ui";

/** Settings layout: one card of rows with small section headers, and a Save bar at the bottom. */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cx("overflow-hidden", className)}>{children}</Card>;
}

export function Section({ title, badge, right }: { title: ReactNode; badge?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-zinc-100 bg-zinc-50/80 px-5 py-1.5 first:border-t-0 dark:border-white/5 dark:bg-white/[0.02]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">{title}</span>
        {badge}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** A name with an optional hint on the left, the control on the right (stacked on a phone). */
export function Row({
  label,
  hint,
  children,
  className,
  inline,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** keep the control on the right on a phone too (a switch) */
  inline?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex min-h-13 gap-2 border-t border-zinc-100 px-5 py-2.5 first:border-t-0 sm:gap-6 dark:border-white/5",
        inline ? "flex-row items-center justify-between gap-4" : "flex-col sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium break-words">{label}</div>
        {hint && <div className="text-xs break-words text-zinc-500 dark:text-zinc-400">{hint}</div>}
      </div>
      {children && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>}
    </div>
  );
}

/** Full-width content inside the card (a callout, a list, a progress bar). */
export function RowBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("border-t border-zinc-100 px-5 py-3 first:border-t-0 dark:border-white/5", className)}>{children}</div>;
}

/**
 * The bar at the bottom of every settings card: Discard and Save, greyed out until something
 * changed. While a required value is missing or one is not valid, Save stays greyed out and
 * the bar says what to fix.
 */
export function SaveBar({
  dirty,
  problem,
  onSave,
  onDiscard,
  loading,
  note,
  saveText = "Save",
  className,
}: {
  /** something was changed */
  dirty: boolean;
  /** what is missing or wrong, e.g. "Enter the sender address"; null when it can be saved */
  problem?: string | null;
  onSave: () => void;
  onDiscard?: () => void;
  loading?: boolean;
  /** shown instead of "Unsaved changes" */
  note?: ReactNode;
  saveText?: string;
  className?: string;
}) {
  const blocked = dirty && !!problem;
  return (
    <div className={cx("flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/80 px-5 py-2.5 dark:border-white/5 dark:bg-white/[0.02]", className)}>
      <span className={cx("mr-auto flex min-w-0 items-center gap-1.5 text-xs", blocked ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500")}>
        {blocked && <AlertCircle className="size-3.5 shrink-0" />}
        {!dirty ? "No unsaved changes" : blocked ? problem : (note ?? "Unsaved changes")}
      </span>
      {onDiscard && (
        <Button size="sm" disabled={!dirty || loading} onClick={onDiscard}>
          Discard
        </Button>
      )}
      <Button size="sm" variant="primary" disabled={!dirty || !!problem} loading={loading} onClick={onSave}>
        {saveText}
      </Button>
    </div>
  );
}

/** In a dialog's footer, left of the buttons: why the Save (or Next) button is off. */
export function FormHint({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <span className="mr-auto flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <AlertCircle className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
