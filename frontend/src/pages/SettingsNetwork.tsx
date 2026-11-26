import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings } from "../lib/types";
import { Badge, Button, Callout, Card, ConfirmDialog, Input, Modal, PageLoader, Segmented, Select, Switch, useToast } from "../components/ui";
import { Row, RowBlock, RowCard, SaveBar, Section } from "../components/rows";

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
  // <name>.local only resolves with Bonjour (mDNS) on
  const services = useQuery({ queryKey: ["services"], queryFn: () => api.get<{ id: string; active: boolean }[]>("/services") });
  const bonjour = !!services.data?.find((x) => x.id === "mdns")?.active;
  const [name, setName] = useState<string | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState<{ url: string | null; mode: "dhcp" | "static" } | null>(null);
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
      const host = f!.mode === "static" ? f!.address.trim() : bonjour ? `${settings.data?.hostname ?? location.hostname}.local` : null;
      setMoving({ url: host ? urlFor(host) : null, mode: f!.mode });
    },
  });

  if (!q.data || !f) return <PageLoader />;
  if (!iface)
    return (
      <div className="space-y-5">
        <WebCard />
        <Card className="p-5">
          <Callout tone="warning">No wired network interface was found.</Callout>
        </Card>
      </div>
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

  const field = (k: "address" | "subnet" | "gateway" | "dns1" | "dns2", placeholder: string) => (
    <div className="w-full sm:w-56">
      <Input value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} inputMode="decimal" className="tabular" aria-label={k} />
      {errors[k] && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errors[k]}</div>}
    </div>
  );
  const ip = (v: string | null) => <span className={cx("tabular font-mono text-[13px]", !v && "text-zinc-400")}>{v || "—"}</span>;

  return (
    <div className="space-y-5">
    {/* HTTPS applies by itself (after a confirmation); the Save bar below is only for the address */}
    <WebCard />
    <RowCard>
      <Section
        title={
          <>
            <span className="normal-case">{iface.name}</span> · <span className="normal-case">{iface.mac}</span>
            {iface.manager && <> · <span className="normal-case">{MANAGER[iface.manager]}</span></>}
          </>
        }
      />
      {iface.unsupported && (
        <RowBlock>
          <Callout tone="warning">{iface.unsupported}.</Callout>
        </RowBlock>
      )}
      {q.data.interfaces.length > 1 && (
        <Row label="Interface">
          <Select value={iface.name} onChange={(e) => setName(e.target.value)} className="w-full sm:w-56" aria-label="Interface">
            {q.data.interfaces.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name}
                {i.address ? ` · ${i.address}` : ""}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row label="IP address" hint={f.mode === "dhcp" ? "Given by your router" : "Fixed, set here"}>
        <Segmented
          value={f.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "dhcp", label: "Automatic" },
            { value: "static", label: "Static" },
          ]}
        />
      </Row>
      {f.mode === "dhcp" ? (
        <>
          <Row label="Address">
            {ip(iface.address)}
            <span className="text-zinc-400">/</span>
            {ip(iface.subnet)}
          </Row>
          <Row label="Gateway · DNS">
            {ip(iface.gateway)}
            <span className="text-zinc-400">·</span>
            {ip(iface.dns.join(", "))}
          </Row>
        </>
      ) : (
        <>
          <Row label="Address">{field("address", "192.168.1.60")}</Row>
          <Row label="Subnet mask">{field("subnet", "255.255.255.0")}</Row>
          <Row label="Gateway" hint="Usually your router">{field("gateway", "192.168.1.1")}</Row>
          <Row label="DNS server">{field("dns1", "192.168.1.1")}</Row>
          <Row label="Second DNS server" hint="Optional">{field("dns2", "1.1.1.1")}</Row>
        </>
      )}
      <SaveBar show={changed} onDiscard={() => setF(start)} disabled={!valid || locked} onSave={() => setConfirm(true)} />
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
              Talon gets its address from your router again; it may change.{" "}
              {bonjour ? (
                <>
                  Open it at <b>{settings.data?.hostname ?? "your NAS"}.local</b> within 3 minutes, or the previous settings come back.
                </>
              ) : (
                <>
                  Look up the new address in your router and open Talon there within 3 minutes, or the previous settings come back. Turn on Bonjour under
                  Services first to open it as <b>{settings.data?.hostname ?? "your NAS"}.local</b> instead.
                </>
              )}
            </>
          )
        }
      />
      {moving && <Moving target={moving} onDone={() => setMoving(null)} />}
    </RowCard>
    </div>
  );
}

/* ---------------------------------------------------------------- HTTPS on/off */

type Web = { https: boolean; port: number; https_port: number; serving_https: boolean };

/** HTTPS on or off, in a card of its own: it applies on its own, not with the Save button of the network settings. */
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
    <RowCard>
      <Section title="Web interface" />
      <Row
        inline
        label={
          <span className="flex flex-wrap items-center gap-2">
            HTTPS {on ? <Badge tone="green">port {q.data.port}</Badge> : <Badge tone="amber">off · http:// on port {q.data.port}</Badge>}
          </span>
        }
        hint="Turn off when Cloudflare or another proxy provides HTTPS"
      >
        <Switch checked={on} onChange={(v) => setAsk(v)} label="HTTPS" />
      </Row>
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
    </RowCard>
  );
}

/** Shown after applying: waits until the NAS is reached again, or the change is undone. */
function Moving({ target, onDone }: { target: { url: string | null; mode: "dhcp" | "static" }; onDone: () => void }) {
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
            {target.url ? (
              <>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {target.mode === "static" ? "Open Talon at its new address:" : "Open Talon by its name; your router has given it a new address:"}
                </p>
                <a
                  href={target.url}
                  className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3 font-mono text-[15px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20"
                >
                  <span className="break-all">{target.url.replace(/\/settings\?tab=network$/, "/")}</span>
                  <ExternalLink className="size-4 shrink-0" />
                </a>
              </>
            ) : (
              <p className="text-zinc-600 dark:text-zinc-400">Your router has given Talon a new address. Look it up in your router and open Talon there.</p>
            )}
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
