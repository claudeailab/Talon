import { useQuery } from "@tanstack/react-query";
import { Apple, Cloud, Copy, FolderSync, Globe, Monitor, Network, RotateCw, Server, Settings2, Terminal } from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { Service } from "../lib/types";
import { Badge, Button, Card, PageHeader, PageLoader, StatusDot, Switch, useToast } from "../components/ui";

const ICONS: Record<string, React.ReactNode> = {
  smb: <Monitor className="size-5" />,
  netbios: <Globe className="size-5" />,
  nfs: <Server className="size-5" />,
  wsdd: <Network className="size-5" />,
  mdns: <Apple className="size-5" />,
  ssh: <Terminal className="size-5" />,
  onedrive: <Cloud className="size-5" />,
  webdav: <FolderSync className="size-5" />,
};

export default function ServicesPage() {
  const { data } = useQuery({ queryKey: ["services"], queryFn: () => api.get<Service[]>("/services"), refetchInterval: 10000 });
  const act = useAction(({ id, action }: { id: string; action: string }) => api.post(`/services/${id}/${action}`), {
    success: (_r, v) => `Service ${v.action === "enable" ? "enabled" : v.action === "disable" ? "disabled" : "restarted"}`,
    invalidate: ["services", "onedrive"],
    onSuccess: (_r, v) => {
      if (v.id === "onedrive" && v.action === "enable") navigate("/onedrive"); // straight to setup
    },
  });
  const toast = useToast();
  const davUrl = `${location.origin}/dav/`;
  if (!data) return <PageLoader />;
  return (
    <>
      <PageHeader title="Services" description="System services" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((s) => (
          <Card key={s.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300">{ICONS[s.id]}</div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.label}</div>
                  <div className="flex items-center gap-1.5 text-xs whitespace-nowrap text-zinc-500">
                    <StatusDot tone={s.active ? "green" : "zinc"} pulse={s.active} />
                    {!s.installed ? "Not installed" : s.active ? "Running" : "Stopped"}
                  </div>
                </div>
              </div>
              <Switch
                checked={s.enabled && s.active}
                disabled={!s.installed || act.isPending}
                label={`Enable ${s.label}`}
                onChange={(v) => act.mutate({ id: s.id, action: v ? "enable" : "disable" })}
              />
            </div>
            <p className="mt-3 text-[13px] text-zinc-500 dark:text-zinc-400">{s.description}</p>
            {s.id === "webdav" && s.enabled && (
              <p className="mt-1 font-mono text-[12.5px] break-all text-zinc-700 dark:text-zinc-300">{davUrl}</p>
            )}
            <div className="mt-4 flex items-center justify-between">
              {s.app ? (
                s.enabled ? <Badge tone="green">Enabled</Badge> : <Badge>Disabled</Badge>
              ) : s.enabled ? (
                <Badge tone="green">Starts at boot</Badge>
              ) : (
                <Badge>Disabled at boot</Badge>
              )}
              {s.id === "webdav" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="size-3.5" />}
                  disabled={!s.enabled}
                  onClick={() => navigator.clipboard?.writeText(davUrl).then(() => toast("success", "Address copied"), () => toast("error", "Copy failed"))}
                >
                  Copy address
                </Button>
              ) : s.app ? (
                <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} disabled={!s.enabled} onClick={() => navigate("/onedrive")}>
                  Configure
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<RotateCw className="size-3.5" />} disabled={!s.installed || !s.active} onClick={() => act.mutate({ id: s.id, action: "restart" })}>
                  Restart
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
