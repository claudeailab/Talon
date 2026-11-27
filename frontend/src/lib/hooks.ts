import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { sameValue } from "./format";
import { useToast } from "../components/ui";

/** Mutation that shows a toast on success/error and refreshes the given queries. */
export function useAction<TVars = void, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes, v: TVars) => string); invalidate?: string[]; onSuccess?: (r: TRes, v: TVars) => void } = {},
) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const msg = typeof opts.success === "function" ? opts.success(r, v) : opts.success;
      if (msg) toast("success", msg);
      (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      opts.onSuccess?.(r, v);
    },
    onError: (e: Error) => toast("error", e.message),
  });
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [
    dark,
    () =>
      setDark((d) => {
        try {
          localStorage.setItem("theme", d ? "light" : "dark");
        } catch {
          /* storage unavailable */
        }
        return !d;
      }),
  ];
}

/**
 * The edits of a settings form, kept until Save. `saved` is what the NAS has; `draft` starts
 * as a copy. When the saved values change (after Save, or a change made elsewhere) the
 * draft starts again from them. A refresh that returns the same values keeps the edits.
 */
export function useDraft<T>(saved: T | undefined) {
  const key = JSON.stringify(saved ?? null);
  const [draft, setDraft] = useState<T | undefined>(saved);
  useEffect(() => {
    if (saved !== undefined) setDraft(saved);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = saved !== undefined && draft !== undefined && !sameValue(draft, saved);
  return {
    draft,
    dirty,
    set: <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d === undefined ? d : { ...d, [k]: v })),
    setAll: (v: T) => setDraft(v),
    reset: () => setDraft(saved),
  };
}
