import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Info, MonitorSmartphone, Power, RotateCcw, Server } from "lucide-react";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings, SysInfo } from "../lib/types";
import { Button, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader, PageLoader, Select, ToggleRow } from "../components/ui";

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const tz = useQuery({ queryKey: ["timezones"], queryFn: () => api.get<string[]>("/settings/timezones"), staleTime: Infinity });
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<SysInfo>("/system") });
  const [form, setForm] = useState<Settings | null>(null);
  const [power, setPower] = useState<"reboot" | "poweroff" | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useAction((body: Partial<Settings>) => api.put<Settings>("/settings", body), {
    success: "Settings saved",
    invalidate: ["settings", "system", "dashboard"],
  });
  const doPower = useAction((action: string) => api.post("/system/power", { action }), {
    success: (_r, a) => (a === "reboot" ? "Rebooting… this page reconnects when the NAS is back." : "Shutting down…"),
    onSuccess: () => setPower(null),
  });
  if (!form || !sys.data) return <PageLoader />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageHeader title="Settings" description="System identity, file sharing defaults and power." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Server className="size-4.5" />} title="General" subtitle="Name and time zone of this NAS" />
          <div className="space-y-4 px-5 pb-5">
            <Field label="Hostname" hint={`Reachable as ${form.hostname}.local on most networks`}>
              <Input value={form.hostname} onChange={(e) => set("hostname", e.target.value)} />
            </Field>
            <Field label="Time zone">
              <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {(tz.data ?? [form.timezone]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ hostname: form.hostname, timezone: form.timezone })}>
                Save
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<MonitorSmartphone className="size-4.5" />} title="SMB / Windows sharing" subtitle="Global Samba settings" />
          <div className="space-y-4 px-5 pb-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Workgroup">
                <Input value={form.workgroup} onChange={(e) => set("workgroup", e.target.value.toUpperCase())} maxLength={15} />
              </Field>
              <Field label="Minimum protocol" hint="SMB2_10 or newer is recommended">
                <Select value={form.smb_min_protocol} onChange={(e) => set("smb_min_protocol", e.target.value)}>
                  {form.smb_protocols.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Server description">
              <Input value={form.server_string} onChange={(e) => set("server_string", e.target.value)} maxLength={64} />
            </Field>
            <ToggleRow
              title="macOS compatibility"
              description="Apple SMB extensions (vfs_fruit) for faster Finder browsing and correct metadata."
              checked={form.smb_macos_compat}
              onChange={(v) => set("smb_macos_compat", v)}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    workgroup: form.workgroup,
                    server_string: form.server_string,
                    smb_min_protocol: form.smb_min_protocol,
                    smb_macos_compat: form.smb_macos_compat,
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Info className="size-4.5" />} title="About" />
          <dl className="space-y-2.5 px-5 pb-5 text-[13px]">
            {[
              ["Talon version", sys.data.version],
              ["Hardware", sys.data.model],
              ["Processor", `${sys.data.cpu} (${sys.data.cores} cores, ${sys.data.arch})`],
              ["Memory", bytes(sys.data.memory)],
              ["Operating system", sys.data.os],
              ["Kernel", sys.data.kernel],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader icon={<Power className="size-4.5" />} title="Power" subtitle="Restart or shut down the NAS" />
          <div className="flex flex-wrap gap-3 px-5 pb-5">
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setPower("reboot")}>
              Restart
            </Button>
            <Button variant="danger" icon={<Power className="size-4" />} onClick={() => setPower("poweroff")}>
              Shut down
            </Button>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={!!power}
        onClose={() => setPower(null)}
        onConfirm={() => power && doPower.mutate(power)}
        loading={doPower.isPending}
        danger={power === "poweroff"}
        title={power === "reboot" ? "Restart the NAS?" : "Shut down the NAS?"}
        confirmText={power === "reboot" ? "Restart" : "Shut down"}
        message={
          power === "reboot"
            ? "Shares will be unavailable for a minute or two while the system restarts."
            : "Shares become unavailable. You will need physical access to switch it back on."
        }
      />
    </>
  );
}
