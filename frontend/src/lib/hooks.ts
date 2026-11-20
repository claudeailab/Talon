import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
