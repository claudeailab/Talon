import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Apple, Check, Copy, FolderOpen, Globe, MonitorSmartphone, Pencil, Plus, Recycle, Server, Trash2, Users as UsersIcon, X } from "lucide-react";
import { api } from "../lib/api";
import { cx, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Access, Group, Share, User, Volume } from "../lib/types";
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Segmented,
  Select,
  Tabs,
  ToggleRow,
  useToast,
} from "../components/ui";

const USERS_GROUP = "nasusers";

function blank(volume: string): Share {
  return {
    name: "",
    volume,
    folder: "",
    description: "",
    guest: "none",
    users: {},
    groups: { [USERS_GROUP]: "rw" },
    smb: { enabled: true, browseable: true, recycle_bin: false, time_machine: false },
    nfs: { enabled: false, clients: [], squash: "all", insecure: false },
    path: null,
  };
}

export default function SharesPage() {
  const shares = useQuery({ queryKey: ["shares"], queryFn: () => api.get<Share[]>("/shares") });
  const vols = useQuery({ queryKey: ["volumes"], queryFn: () => api.get<Volume[]>("/volumes") });
  const host = useQuery({ queryKey: ["system"], queryFn: () => api.get<{ hostname: string; addresses: { address: string; family: number }[] }>("/system") });
  const [edit, setEdit] = useState<{ share: Share; isNew: boolean } | null>(null);
  const [del, setDel] = useState<Share | null>(null);
  const remove = useAction((n: string) => api.del(`/shares/${n}`), {
    success: "Share deleted. Its files were kept on the volume.",
    invalidate: ["shares", "volumes"],
    onSuccess: () => setDel(null),
  });
  if (!shares.data || !vols.data) return <PageLoader />;
  const mounted = vols.data.filter((v) => v.mounted);
  const hostname = host.data?.hostname ?? "nas";
  const ip = host.data?.addresses.find((a) => a.family === 4)?.address ?? hostname;

  return (
    <>
      <PageHeader
        title="Shared folders"
        description="Folders on your volumes that are accessible over the network via SMB (Windows/macOS/Linux) and NFS."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} disabled={!mounted.length} onClick={() => setEdit({ share: blank(mounted[0].name), isNew: true })}>
            New share
          </Button>
        }
      />
      {mounted.length === 0 && (
        <Callout tone="info" className="mb-6" title="Create a volume first">
          Shared folders are stored on a volume. Go to Volumes & RAID to create one.
        </Callout>
      )}
      {shares.data.length === 0 ? (
        <Card>
          <Empty icon={<FolderOpen className="size-6" />} title="No shared folders" text="Create a shared folder to make storage available on your network." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shares.data.map((s) => (
            <ShareCard key={s.name} s={s} ip={ip} hostname={hostname} onEdit={() => setEdit({ share: s, isNew: false })} onDelete={() => setDel(s)} />
          ))}
        </div>
      )}
      {edit && <ShareEditor initial={edit.share} isNew={edit.isNew} volumes={mounted} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.name)}
        loading={remove.isPending}
        danger
        title={`Delete share ${del?.name}?`}
        confirmText="Delete share"
        message={
          <>
            The share stops being available on the network. <b>The files are not deleted</b> — they remain in <span className="font-mono">{del?.path}</span>.
          </>
        }
      />
    </>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-zinc-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-md bg-zinc-100 px-2 py-1 font-mono text-[11.5px] dark:bg-white/5">{value}</code>
      <button
        title="Copy"
        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          });
        }}
      >
        {done ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function ShareCard({ s, ip, hostname, onEdit, onDelete }: { s: Share; ip: string; hostname: string; onEdit: () => void; onDelete: () => void }) {
  const principals = [
    ...Object.entries(s.groups).map(([n, a]) => ({ n: n === USERS_GROUP ? "All users" : `@${n}`, a, g: true })),
    ...Object.entries(s.users).map(([n, a]) => ({ n, a, g: false })),
  ];
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <FolderOpen className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{s.name}</h3>
            <p className="truncate text-[13px] text-zinc-500">{s.description || `on ${s.volume}`}</p>
          </div>
        </div>
        <div className="flex">
          <IconButton label="Edit" onClick={onEdit}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label="Delete" onClick={onDelete}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-5">
        {s.smb.enabled && <Badge tone="blue">SMB</Badge>}
        {s.nfs.enabled && <Badge tone="violet">NFS</Badge>}
        {s.guest === "ro" && <Badge tone="amber">Guest read</Badge>}
        {s.smb.recycle_bin && (
          <Badge>
            <Recycle className="size-3" /> Recycle bin
          </Badge>
        )}
        {s.smb.time_machine && (
          <Badge>
            <Apple className="size-3" /> Time Machine
          </Badge>
        )}
        {!s.smb.enabled && !s.nfs.enabled && <Badge tone="red">Not shared</Badge>}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 px-5">
        {principals.length === 0 && s.guest === "none" ? (
          <span className="text-xs text-zinc-500">Nobody has access yet</span>
        ) : (
          principals.map((p) => (
            <span
              key={p.n}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-xs font-medium dark:bg-white/5"
            >
              {p.g && <UsersIcon className="size-3 text-zinc-400" />}
              {p.n}
              <span className={cx("text-[10px] font-semibold uppercase", p.a === "rw" ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400")}>
                {p.a === "rw" ? "RW" : "RO"}
              </span>
            </span>
          ))
        )}
      </div>
      <div className="mt-auto space-y-1.5 border-t border-zinc-100 px-5 py-4 dark:border-white/5" style={{ marginTop: 16 }}>
        {s.smb.enabled && (
          <>
            <CopyLine label="Windows" value={`\\\\${ip}\\${s.name}`} />
            <CopyLine label="macOS" value={`smb://${hostname}.local/${s.name}`} />
          </>
        )}
        {s.nfs.enabled && <CopyLine label="NFS" value={`${ip}:${s.path}`} />}
      </div>
    </Card>
  );
}

function AccessPicker({ value, onChange }: { value: Access | "none"; onChange: (v: Access | "none") => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "none", label: "No access" },
        { value: "ro", label: "Read", tone: "text-sky-700 dark:text-sky-300" },
        { value: "rw", label: "Read/Write", tone: "text-emerald-700 dark:text-emerald-300" },
      ]}
    />
  );
}

function ShareEditor({ initial, isNew, volumes, onClose }: { initial: Share; isNew: boolean; volumes: Volume[]; onClose: () => void }) {
  const [s, setS] = useState<Share>(structuredClone(initial));
  const [tab, setTab] = useState<"general" | "perm" | "smb" | "nfs">("general");
  const [client, setClient] = useState("");
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const toast = useToast();
  const save = useAction(() => (isNew ? api.post("/shares", s) : api.put(`/shares/${initial.name}`, s)), {
    success: isNew ? `Share ${s.name} created` : "Share saved",
    invalidate: ["shares", "volumes"],
    onSuccess: onClose,
  });
  const set = <K extends keyof Share>(k: K, v: Share[K]) => setS((x) => ({ ...x, [k]: v }));
  const setPerm = (kind: "users" | "groups", n: string, a: Access | "none") =>
    setS((x) => {
      const m = { ...x[kind] };
      if (a === "none") delete m[n];
      else m[n] = a;
      return { ...x, [kind]: m };
    });
  const nameErr = s.name && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(s.name) ? "Letters, digits, . _ - only (no spaces)" : null;
  const addClient = () => {
    const h = client.trim();
    if (!h) return;
    if (!/^(\*|[A-Za-z0-9*?.:_-]+(\/[0-9]{1,3})?)$/.test(h)) {
      toast("error", "Enter an IP, a network like 192.168.1.0/24, a hostname or *");
      return;
    }
    set("nfs", { ...s.nfs, clients: [...s.nfs.clients, { host: h, access: "rw" }] });
    setClient("");
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New shared folder" : `Edit ${initial.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!s.name || !!nameErr || (!isNew && sameValue(s, initial))}
            onClick={() => save.mutate()}
          >
            {isNew ? "Create share" : "Save"}
          </Button>
        </>
      }
    >
      <div className="-mt-2 mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "general", label: "General" },
            { value: "perm", label: "Permissions" },
            { value: "smb", label: <><MonitorSmartphone className="size-4" /> SMB</> },
            { value: "nfs", label: <><Server className="size-4" /> NFS</> },
          ]}
        />
      </div>

      {tab === "general" && (
        <div className="space-y-4">
          <Field label="Name" error={nameErr} hint="This is the name clients see on the network.">
            <Input value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Media" />
          </Field>
          <Field label="Volume" hint={isNew ? `A folder named "${s.name || "…"}" is created on this volume.` : "The volume of an existing share cannot be changed."}>
            <Select value={s.volume} disabled={!isNew} onChange={(e) => set("volume", e.target.value)}>
              {volumes.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description (optional)">
            <Input value={s.description} onChange={(e) => set("description", e.target.value)} maxLength={200} />
          </Field>
        </div>
      )}

      {tab === "perm" && (
        <div className="space-y-5">
          <p className="text-[13px] text-zinc-500">
            Controls who can access this share over SMB. A user gets the highest access granted to them directly or through a group.
          </p>
          <div className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
            <PermRow icon={<Globe className="size-4" />} title="Guests" subtitle="Anyone on the network, without a password">
              <Segmented
                size="sm"
                value={s.guest}
                onChange={(v) => set("guest", v)}
                options={[
                  { value: "none", label: "No access" },
                  { value: "ro", label: "Read", tone: "text-sky-700 dark:text-sky-300" },
                ]}
              />
            </PermRow>
            <PermRow icon={<UsersIcon className="size-4" />} title="All NAS users" subtitle="Every user account">
              <AccessPicker value={s.groups[USERS_GROUP] ?? "none"} onChange={(a) => setPerm("groups", USERS_GROUP, a)} />
            </PermRow>
            {(groups.data ?? []).map((g) => (
              <PermRow key={g.name} icon={<UsersIcon className="size-4" />} title={`@${g.name}`} subtitle={`${g.members.length} member(s)`}>
                <AccessPicker value={s.groups[g.name] ?? "none"} onChange={(a) => setPerm("groups", g.name, a)} />
              </PermRow>
            ))}
            {(users.data ?? []).map((u) => (
              <PermRow
                key={u.name}
                icon={<span className="text-xs font-semibold uppercase">{u.name[0]}</span>}
                title={u.name}
                subtitle={u.full_name !== u.name ? u.full_name : undefined}
              >
                <AccessPicker value={s.users[u.name] ?? "none"} onChange={(a) => setPerm("users", u.name, a)} />
              </PermRow>
            ))}
          </div>
        </div>
      )}

      {tab === "smb" && (
        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          <ToggleRow
            title="Share over SMB"
            description="Windows, macOS, Linux, Android and iOS file managers."
            checked={s.smb.enabled}
            onChange={(v) => set("smb", { ...s.smb, enabled: v })}
          />
          <ToggleRow
            title="Visible in network browsing"
            description="When off, users must type the share name to connect."
            checked={s.smb.browseable}
            disabled={!s.smb.enabled}
            onChange={(v) => set("smb", { ...s.smb, browseable: v })}
          />
          <ToggleRow
            title="Recycle bin"
            description="Deleted files are moved to a hidden .recycle folder instead of being removed."
            checked={s.smb.recycle_bin}
            disabled={!s.smb.enabled}
            onChange={(v) => set("smb", { ...s.smb, recycle_bin: v })}
          />
          <ToggleRow
            title="Time Machine backups"
            description="Advertise this share as a macOS Time Machine destination."
            checked={s.smb.time_machine}
            disabled={!s.smb.enabled}
            onChange={(v) => set("smb", { ...s.smb, time_machine: v })}
          />
        </div>
      )}

      {tab === "nfs" && (
        <div className="space-y-5">
          <ToggleRow
            title="Share over NFS"
            description="For Linux/Unix clients, Kodi, VMware ESXi and Proxmox. Access is granted per client address."
            checked={s.nfs.enabled}
            onChange={(v) => set("nfs", { ...s.nfs, enabled: v })}
          />
          {s.nfs.enabled && (
            <>
              <div>
                <div className="mb-1.5 text-[13px] font-medium">Allowed clients</div>
                <div className="flex gap-2">
                  <Input
                    value={client}
                    placeholder="192.168.1.0/24, 10.0.0.5, host.lan or *"
                    onChange={(e) => setClient(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addClient())}
                  />
                  <Button onClick={addClient} icon={<Plus className="size-4" />}>
                    Add
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {s.nfs.clients.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 ring-1 ring-zinc-200 dark:ring-white/10">
                      <span className="font-mono text-[13px]">{c.host}</span>
                      <div className="flex items-center gap-2">
                        <Segmented
                          size="sm"
                          value={c.access}
                          onChange={(a) => set("nfs", { ...s.nfs, clients: s.nfs.clients.map((x, j) => (j === i ? { ...x, access: a } : x)) })}
                          options={[
                            { value: "ro", label: "Read" },
                            { value: "rw", label: "Read/Write" },
                          ]}
                        />
                        <IconButton label="Remove" onClick={() => set("nfs", { ...s.nfs, clients: s.nfs.clients.filter((_, j) => j !== i) })}>
                          <X className="size-4" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                  {s.nfs.clients.length === 0 && <Callout tone="warning">Add at least one client network or address.</Callout>}
                </div>
              </div>
              <Field label="User mapping" hint="How file ownership from NFS clients is handled.">
                <Select value={s.nfs.squash} onChange={(e) => set("nfs", { ...s.nfs, squash: e.target.value as Share["nfs"]["squash"] })}>
                  <option value="all">Map all users to the NAS users group (simplest, recommended)</option>
                  <option value="root">Keep client user IDs, map root to nobody</option>
                  <option value="none">Keep all IDs including root (trusted hosts only)</option>
                </Select>
              </Field>
              <ToggleRow
                title="Allow unprivileged source ports"
                description="Needed for macOS Finder and some clients (NFS 'insecure' option)."
                checked={s.nfs.insecure}
                onChange={(v) => set("nfs", { ...s.nfs, insecure: v })}
              />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function PermRow({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-white/5">{icon}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-zinc-500">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
