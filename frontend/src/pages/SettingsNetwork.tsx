import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalLink, Lock, Network } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings } from "../lib/types";
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, Field, Input, Modal, PageLoader, Segmented, Select, ToggleRow, useToast } from "../components/ui";

interface Iface {
  name: string;
  mac: string;
  up: boolean;
  wireless: boolean;
  manager: string | null;
  mode: "dhcp" | "static";
  address: string | null;
  prefix: number | null;
  subnet: string | null;
  gateway: string | null;
  dns: string[];
  default: boolean;
  unsupported: string | null;
}
interface Pending {
  iface: string;
  mode: "dhcp" | "static";
  address: string | null;
  deadline: number;
  applied: number | null;
  error: string | null;
}
interface NetInfo {
  interfaces: Iface[];
  pending: Pending | null;
}

type Form = { mode: "dhcp" | "static"; address: string; subnet: string; gateway: string; dns1: string; dns2: string };

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MANAGER: Record<string, string> = { networkmanager: "NetworkManager", netplan: "netplan", ifupdown: "ifupdown" };

function formOf(i: Iface): Form {
  return {
    mode: i.mode,
    address: i.address ?? "",
    subnet: i.subnet ?? "255.255.255.0",
    gateway: i.gateway ?? "",
    dns1: i.dns[0] ?? i.gateway ?? "",
    dns2: i.dns[1] ?? "",
  };
}

/** The address of this page with another host, e.g. https://192.168.1.60/settings?tab=network */
function urlFor(host: string): string {
  return `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}/settings?tab=network`;
}

export default function NetworkTab() {
  const q = useQuery({ queryKey: ["network"], queryFn: () => api.get<NetInfo>("/network") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const [name, setName] = useState<string | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState<{ url: string; mode: "dhcp" | "static" } | null>(null);
  const iface = q.data?.interfaces.find((i) => i.name === name) ?? q.data?.interfaces[0];
  useEffect(() => {
    if (iface) {
      setName(iface.name);
      setF(formOf(iface));
    }
  }, [iface?.name, iface?.mode, iface?.address, iface?.gateway, iface?.dns.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({
    iface: iface!.name,
    mode: f!.mode,
    ...(f!.mode === "static" ? { address: f!.address.trim(), subnet: f!.subnet.trim(), gateway: f!.gateway.trim(), dns: [f!.dns1.trim(), f!.dns2.trim()] } : {}),
  });
  const apply = useAction(() => api.put<NetInfo>("/network", body()), {
    onSuccess: () => {
      setConfirm(false);
      const host = f!.mode === "static" ? f!.address.trim() : `${settings.data?.hostname ?? location.hostname}.local`;
      setMoving({ url: urlFor(host), mode: f!.mode });
    },
  });

  if (!q.data || !f) return <PageLoader />;
  if (!iface)
    return (
      <Card className="p-5">
        <Callout tone="warning">No wired network interface was found.</Callout>
      </Card>
    );

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x!, [k]: v }));
  const errors =
    f.mode === "static"
      ? {
          address: f.address && !IP_RE.test(f.address.trim()) ? "Enter an address like 192.168.1.60" : null,
          subnet: f.subnet && !IP_RE.test(f.subnet.trim()) ? "Enter a mask like 255.255.255.0" : null,
          gateway: f.gateway && !IP_RE.test(f.gateway.trim()) ? "Enter an address like 192.168.1.1" : null,
          dns1: f.dns1 && !IP_RE.test(f.dns1.trim()) ? "Enter an address like 1.1.1.1" : null,
          dns2: f.dns2 && !IP_RE.test(f.dns2.trim()) ? "Enter an address like 8.8.8.8" : null,
        }
      : {};
  const complete = f.mode === "dhcp" || (!!f.address && !!f.subnet && !!f.gateway && !!f.dns1);
  const valid = complete && Object.values(errors).every((e) => !e);
  const start = formOf(iface);
  const changed =
    f.mode !== iface.mode ||
    (f.mode === "static" && (["address", "subnet", "gateway", "dns1", "dns2"] as const).some((k) => f[k].trim() !== start[k]));
  const locked = !iface.manager || !!q.data.pending;
  const sameAddress = f.mode === "static" && f.address.trim() === iface.address;

  return (
    <>
      <Card>
        <CardHeader
          icon={<Network className="size-4.5" />}
          title={
            <span className="flex items-center gap-2">
              Network {iface.mode === "static" ? <Badge tone="violet" dot>Static IP</Badge> : <Badge tone="blue" dot>DHCP</Badge>}
            </span>
          }
          subtitle={`${iface.name} · ${iface.mac}${iface.manager ? ` · managed by ${MANAGER[iface.manager]}` : ""}`}
          actions={
            <Button variant="primary" disabled={!changed || !valid || locked} onClick={() => setConfirm(true)}>
              Save
            </Button>
          }
        />
        <div className="space-y-5 px-5 pb-5">
          {iface.unsupported && <Callout tone="warning">{iface.unsupported}.</Callout>}
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            {q.data.interfaces.length > 1 && (
              <Field label="Interface">
                <Select value={iface.name} onChange={(e) => setName(e.target.value)} className="w-56">
                  {q.data.interfaces.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                      {i.address ? ` · ${i.address}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">IP address</div>
              <Segmented
                value={f.mode}
                onChange={(v) => set("mode", v)}
                options={[
                  { value: "dhcp", label: "Automatic (DHCP)" },
                  { value: "static", label: "Static IP" },
                ]}
              />
            </div>
          </div>

          {f.mode === "dhcp" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Value label="IP address" value={iface.address} />
              <Value label="Subnet mask" value={iface.subnet} />
              <Value label="Gateway" value={iface.gateway} />
              <Value label="DNS servers" value={iface.dns.join(", ")} />
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-4 md:grid-cols-3 [&>*]:min-w-0">
              <Field label="IP address" error={errors.address}>
                <Input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="192.168.1.60" inputMode="decimal" className="tabular" />
              </Field>
              <Field label="Subnet mask" error={errors.subnet}>
                <Input value={f.subnet} onChange={(e) => set("subnet", e.target.value)} placeholder="255.255.255.0" inputMode="decimal" className="tabular" />
              </Field>
              <Field label="Gateway" hint="Usually your router" error={errors.gateway}>
                <Input value={f.gateway} onChange={(e) => set("gateway", e.target.value)} placeholder="192.168.1.1" inputMode="decimal" className="tabular" />
              </Field>
              <Field label="DNS server" error={errors.dns1}>
                <Input value={f.dns1} onChange={(e) => set("dns1", e.target.value)} placeholder="192.168.1.1" inputMode="decimal" className="tabular" />
              </Field>
              <Field label="Second DNS server" hint="Optional" error={errors.dns2}>
                <Input value={f.dns2} onChange={(e) => set("dns2", e.target.value)} placeholder="1.1.1.1" inputMode="decimal" className="tabular" />
              </Field>
            </div>
          )}

        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => apply.mutate()}
        loading={apply.isPending}
        title="Change the network settings?"
        confirmText="Apply"
        message={
          f.mode === "static" ? (
            sameAddress ? (
              <>Talon keeps the address <b>{f.address.trim()}</b>, now as a static IP.</>
            ) : (
              <>
                Talon moves from <b>{iface.address}</b> to <b>{f.address.trim()}</b>. Open it at the new address within 3 minutes, or the previous settings come
                back.
              </>
            )
          ) : (
            <>
              Talon gets its address from your router again; it may change. Open it at <b>{settings.data?.hostname ?? "your NAS"}.local</b> within 3 minutes, or the
              previous settings come back.
            </>
          )
        }
      />
      {moving && <Moving target={moving} onDone={() => setMoving(null)} />}
      <WebCard />
    </>
  );
}

/* ---------------------------------------------------------------- HTTPS on/off */

type Web = { https: boolean; port: number; https_port: number; serving_https: boolean };

function WebCard() {
  const q = useQuery({ queryKey: ["web"], queryFn: () => api.get<Web>("/settings/web") });
  const [ask, setAsk] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const save = useAction((on: boolean) => api.put<{ https: boolean; port: number; restarting: boolean }>("/settings/web", { https: on }), {
    invalidate: ["web"],
    onSuccess: (r) => {
      setAsk(null);
      if (!r.restarting) return;
      // Behind a proxy (a domain name) the address stays the same; on the LAN the scheme and port change.
      const direct = /^(\d+\.){3}\d+$|\.local$|^localhost$/.test(location.hostname);
      const port = (r.https && r.port === 443) || (!r.https && r.port === 80) ? "" : `:${r.port}`;
      const url = direct ? `${r.https ? "https:" : "http:"}//${location.hostname}${port}/settings?tab=network` : location.href;
      setRestarting(url);
      setTimeout(() => (location.href = url), 6000);
    },
  });
  if (!q.data) return null;
  const on = q.data.https;
  return (
    <Card className="mt-5">
      <CardHeader
        icon={<Lock className="size-4.5" />}
        title={
          <span className="flex items-center gap-2">
            Web Interface {on ? <Badge tone="green" dot>HTTPS</Badge> : <Badge tone="amber" dot>HTTP</Badge>}
          </span>
        }
        subtitle={on ? `https:// on port ${q.data.port}, with Talon's own certificate` : `Plain http:// on port ${q.data.port}`}
      />
      <div className="px-5 pb-3">
        <ToggleRow
          title="HTTPS"
          description="Turn off when Cloudflare or another proxy provides HTTPS"
          checked={on}
          onChange={(v) => setAsk(v)}
        />
      </div>
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        onConfirm={() => ask !== null && save.mutate(ask)}
        loading={save.isPending}
        title={ask ? "Turn HTTPS on?" : "Turn HTTPS off?"}
        confirmText={ask ? "Turn on" : "Turn off"}
        message={
          ask
            ? `Talon restarts and is served over https:// on port ${q.data.https_port} again.`
            : "Talon restarts and is served over plain http:// on port 80. Passwords then cross your network unencrypted unless a proxy such as Cloudflare adds HTTPS."
        }
      />
      {restarting && (
        <Modal open onClose={() => setRestarting(null)} title="Talon is restarting" description="This takes a few seconds">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Opening <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{restarting.replace(/\/settings\?tab=network$/, "/")}</span>
          </p>
        </Modal>
      )}
    </Card>
  );
}

function Value({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3.5 py-2.5 dark:bg-white/[0.03]">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={cx("tabular truncate text-sm font-medium", !value && "text-zinc-400")}>{value || "—"}</div>
    </div>
  );
}

/** Shown after applying: waits until the NAS is reached again, or the change is undone. */
function Moving({ target, onDone }: { target: { url: string; mode: "dhcp" | "static" }; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now() / 1000);
  const q = useQuery({
    queryKey: ["network-pending"],
    queryFn: () => api.get<NetInfo>("/network"),
    refetchInterval: 2000,
    retry: false,
  });
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const pending = q.data?.pending;
  useEffect(() => {
    if (q.data && !q.data.pending && q.dataUpdatedAt > 0) {
      toast("success", "Network settings saved");
      qc.invalidateQueries({ queryKey: ["network"] });
      onDone();
    }
  }, [q.data, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = pending?.applied ? Math.max(0, Math.round(pending.deadline - now)) : null;
  return (
    <Modal open onClose={onDone} title="Network settings applied" description="Waiting for Talon to be reached at its new address" footer={<Button onClick={onDone}>Close</Button>}>
      <div className="space-y-4 text-sm">
        {pending?.error ? (
          <Callout tone="danger" title="The change failed; nothing was changed">
            {pending.error}
          </Callout>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              {target.mode === "static" ? "Open Talon at its new address:" : "Open Talon by its name; your router has given it a new address:"}
            </p>
            <a
              href={target.url}
              className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3 font-mono text-[15px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20"
            >
              <span className="truncate">{target.url.replace(/\/settings\?tab=network$/, "/")}</span>
              <ExternalLink className="size-4 shrink-0" />
            </a>
            <p className="text-[13px] text-zinc-500">
              {left === null
                ? "Applying the new settings…"
                : `Previous settings return in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} if Talon is not opened there.`}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
