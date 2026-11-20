import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { Job } from "../lib/types";
import { Button, Modal } from "./ui";

export function JobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ["success", "error"].includes(q.state.data.status) ? false : 800),
  });
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [data?.log?.length]);
  const done = data && ["success", "error"].includes(data.status);
  return (
    <Modal
      open={!!jobId}
      onClose={onClose}
      size="lg"
      title={data?.title ?? "Working…"}
      description={
        data?.status === "success"
          ? "Completed successfully"
          : data?.status === "error"
            ? data.error
            : "This may take a while. You can close this window; the task keeps running."
      }
      icon={
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/5">
          {!done && <Loader2 className="size-5 animate-spin text-brand-500" />}
          {data?.status === "success" && <CheckCircle2 className="size-5 text-emerald-500" />}
          {data?.status === "error" && <XCircle className="size-5 text-rose-500" />}
        </div>
      }
      footer={<Button variant={done ? "primary" : "secondary"} onClick={onClose}>{done ? "Done" : "Run in background"}</Button>}
    >
      <pre
        ref={logRef}
        className="max-h-80 overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-300 ring-1 ring-white/10"
      >
        {(data?.log ?? ["Starting…"]).join("\n")}
      </pre>
    </Modal>
  );
}
