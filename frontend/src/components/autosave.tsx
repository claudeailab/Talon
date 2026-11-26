import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { cx } from "../lib/format";
import { Input } from "./ui";

/* Settings save themselves, everywhere in Talon: a switch, a choice or a list saves as
   soon as it changes; a text field saves when you leave it or press Enter (Escape puts
   the saved value back). A value that is not valid is shown in red and not saved. Only
   dialogs (Create, Save) and moving the NAS to another network address (Apply) have a
   button. */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  /** the saved value */
  value: string;
  /** saves the new value; rejects when it could not be saved (the error is shown by the caller) */
  onSave: (v: string) => Promise<unknown>;
  /** an error to show, or null when the value can be saved */
  validate?: (v: string) => string | null;
  /** applied while typing, e.g. digits only */
  filter?: (v: string) => string;
  /** a password: the field stays empty and saves only what is typed into it */
  secret?: boolean;
  /** text in a box at the end of the field, e.g. "°C" */
  suffix?: ReactNode;
  /** the width of the whole field */
  width?: string;
};

export function AutoField({ value, onSave, validate, filter, secret, suffix, width = "w-full sm:w-72", className, ...rest }: Props) {
  const saved = secret ? "" : value;
  const [draft, setDraft] = useState(saved);
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focused) setDraft(saved);
  }, [saved, focused]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const error = draft !== saved && validate ? validate(draft) : null;
  const commit = async () => {
    const v = draft.trim();
    if (v === saved || (secret && !v) || (validate && validate(v))) return;
    setState("saving");
    try {
      await onSave(v);
      if (secret) setDraft("");
      setState("saved");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("idle");                                   // keep the text, so it can be corrected
    }
  };
  const status =
    state === "saving" ? <Loader2 className="size-4 animate-spin text-zinc-400" /> : state === "saved" ? <Check className="size-4 text-emerald-500" strokeWidth={3} /> : null;
  return (
    <div className={cx("min-w-0", width)}>
      <div className="flex">
        <div className="relative min-w-0 flex-1">
          <Input
            {...rest}
            type={secret ? "password" : rest.type}
            value={draft}
            onChange={(e) => setDraft(filter ? filter(e.target.value) : e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(saved);
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-invalid={!!error}
            className={cx(status && "pr-9", suffix != null && "rounded-r-none", error && "ring-rose-400 focus:ring-rose-500 dark:ring-rose-400/60", className)}
          />
          {status && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">{status}</span>}
        </div>
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
