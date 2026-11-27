import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/format";
import { Input } from "./ui";

/* A text field in a settings card. It only edits the card's draft: nothing is saved until
   the card's Save button is clicked. A value that is not valid is outlined in red with a
   line saying why, and the Save button stays off until it is fixed. */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
  /** why the value is not valid, or null */
  error?: string | null;
  /** applied while typing, e.g. digits only */
  filter?: (v: string) => string;
  /** text in a box at the end of the field, e.g. "°C" */
  suffix?: ReactNode;
  /** the width of the whole field */
  width?: string;
};

export function TextField({ value, onChange, error, filter, suffix, width = "w-full sm:w-72", className, ...rest }: Props) {
  return (
    <div className={cx("min-w-0", width)}>
      <div className="flex">
        <Input
          {...rest}
          value={value}
          onChange={(e) => onChange(filter ? filter(e.target.value) : e.target.value)}
          aria-invalid={!!error}
          className={cx("min-w-0 flex-1", suffix != null && "rounded-r-none", error && "ring-rose-400 focus:ring-rose-500 dark:ring-rose-400/60", className)}
        />
        {suffix != null && (
          <span className="-ml-px flex w-18 shrink-0 items-center justify-center rounded-r-xl bg-zinc-50 px-2 text-[13px] whitespace-nowrap text-zinc-500 ring-1 ring-zinc-200 ring-inset dark:bg-white/[0.03] dark:ring-white/10">
            {suffix}
          </span>
        )}
      </div>
      {error && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}
