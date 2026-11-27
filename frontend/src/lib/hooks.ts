import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
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
    // the refreshed data is in before onSuccess runs (and the button stops spinning)
    onSuccess: async (r, v) => {
      const msg = typeof opts.success === "function" ? opts.success(r, v) : opts.success;
      if (msg) toast("success", msg);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: [k] })));
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
  // bumped after a save: the draft starts again from the saved values even when they did
  // not change (e.g. "a,b" saved as "a, b"), so the bar does not keep saying "Unsaved changes"
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (saved !== undefined) setDraft(saved);
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = saved !== undefined && draft !== undefined && !sameValue(draft, saved);
  return {
    draft,
    dirty,
    set: <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d === undefined ? d : { ...d, [k]: v })),
    setAll: (v: T) => setDraft(v),
    reset: () => setDraft(saved),
    /** call when a save succeeded (after the data was refreshed) */
    saved: () => setTick((n) => n + 1),
  };
}

/**
 * A scrolling box that shows the newest lines (a log, a command's output): it opens
 * scrolled to the end and stays there as lines arrive, unless the user scrolls up to
 * read something; scrolling back to the end follows again. Spread on the element:
 * `<pre {...useFollow(lines)}>`.
 */
export function useFollow<T extends HTMLElement>(content: unknown) {
  const el = useRef<T | null>(null);
  const follow = useRef(true);
  const ref = useCallback((node: T | null) => {
    el.current = node;
    if (node) {
      follow.current = true;
      node.scrollTop = node.scrollHeight;
    }
  }, []);
  useLayoutEffect(() => {
    const node = el.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [content]);
  const onScroll = (e: UIEvent<T>) => {
    const node = e.currentTarget;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };
  return { ref, onScroll };
}
