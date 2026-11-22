import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Group, Job, User } from "../lib/types";
import { Button, Callout, Input, Modal, PageLoader, Segmented, SubTabs } from "./ui";

type Access = "ro" | "rw";
type Info = {
  volume: string;
  path: string;
  share: string | null;
  share_root: boolean;
  share_users: Record<string, Access>;
  share_groups: Record<string, Access>;
  custom: { users: Record<string, Access>; groups: Record<string, Access> } | null;
  inherited_from: string | null;
};
const ALL = "nasusers";
const LABEL: Record<string, string> = { ro: "Read", rw: "Read & write" };

/** Files → a folder's ⋯ → Permissions. */
export function FolderPermsDialog({ volume, path, onClose, onDone }: { volume: string; path: string; onClose: () => void; onDone: (jobId: string) => void }) {
  const q = useQuery({ queryKey: ["folder-perms", volume, path], queryFn: () => api.get<Info>(`/folder-perms?${new URLSearchParams({ volume, path })}`) });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const [custom, setCustom] = useState(false);
  const [u, setU] = useState<Record<string, Access>>({});
  const [g, setG] = useState<Record<string, Access>>({});
  const [view, setView] = useState<"users" | "groups">("users");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setCustom(!!q.data.custom);
    setU(q.data.custom?.users ?? {});
    setG(q.data.custom?.groups ?? {});
  }, [q.data]);
  const save = useAction(() => api.put<Job>("/folder-perms", { volume, path, custom, users: u, groups: g }), {
    success: "Saving the permissions",
    invalidate: ["folder-perms", "files"],
    onSuccess: (j) => onDone(j.id),
  });
  const name = path.split("/").filter(Boolean).pop() ?? path;
  if (!q.data || !users.data || !groups.data)
    return (
      <Modal open onClose={onClose} title="Permissions">
        <PageLoader />
      </Modal>
    );
  const d = q.data;
  // what the shared folder gives someone: users directly, or a group they are in (or all NAS users)
  const shareAccessUser = (n: string): Access | null => {
    const user = users.data!.find((x) => x.name === n);
    const all: (Access | undefined)[] = [d.share_users[n], d.share_groups[ALL], ...(user?.groups ?? []).map((gr) => d.share_groups[gr])];
    return all.includes("rw") ? "rw" : all.includes("ro") ? "ro" : null;
  };
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (t: string) => words.every((w) => t.toLowerCase().includes(w));
  const groupRows = [{ name: ALL, members: users.data.map((x) => x.name), description: "" }, ...groups.data];
  const changed = !!d.custom !== custom || (custom && (JSON.stringify(u) !== JSON.stringify(d.custom?.users ?? {}) || JSON.stringify(g) !== JSON.stringify(d.custom?.groups ?? {})));
  const blocked = !d.share || d.share_root;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Permissions"
      description={`${d.share ?? volume} / ${name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={blocked || !changed || (custom && !Object.keys(u).length && !Object.keys(g).length)} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {!d.share ? (
        <Callout tone="info">Folder permissions apply to folders inside a shared folder. This folder is not in one.</Callout>
      ) : d.share_root ? (
        <Callout tone="info">This is the shared folder {d.share} itself. Change who can open it under Shared Folders → Edit → Permissions.</Callout>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2">
            <Choice on={!custom} title="Same as the shared folder" text={`Who can open ${d.share} can open this folder`} onClick={() => setCustom(false)} />
            <Choice on={custom} title="Custom" text="Choose who can open this folder and what is inside it" onClick={() => setCustom(true)} />
          </div>
          {d.inherited_from && !custom && (
            <p className="text-xs text-zinc-500">A folder above this one ({d.inherited_from.split("/").pop()}) has custom permissions; they apply here too.</p>
          )}
          {custom && (
            <>
              <SubTabs
                value={view}
                onChange={(v) => {
                  setView(v);
                  setSearch("");
                }}
                tabs={[
                  { value: "users", label: "Users", count: Object.keys(u).length },
                  { value: "groups", label: "Groups", count: Object.keys(g).length },
                ]}
              />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === "users" ? "Search users" : "Search groups"} aria-label="Search" />
              <div className="max-h-[22rem] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
                {view === "users" &&
                  users.data
                    .filter((x) => match(`${x.name} ${x.full_name}`))
                    .map((x) => {
                      const sa = shareAccessUser(x.name);
                      return (
                        <Row
                          key={x.name}
                          icon={<span className="text-xs font-semibold uppercase">{x.name[0]}</span>}
                          title={x.name}
                          subtitle={sa ? `${LABEL[sa]} on ${d.share}` : `No access to ${d.share}`}
                          value={u[x.name] ?? "none"}
                          max={sa}
                          onChange={(a) => setU(set(u, x.name, a))}
                        />
                      );
                    })}
                {view === "groups" &&
                  groupRows
                    .filter((x) => match(x.name === ALL ? "All NAS users" : `${x.name} ${x.description}`))
                    .map((x) => {
                      const sa = d.share_groups[x.name] ?? null;
                      return (
                        <Row
                          key={x.name}
                          icon={<UsersIcon className="size-4" />}
                          title={x.name === ALL ? "All NAS users" : x.name}
                          subtitle={`${x.name === ALL ? "Everyone" : `${x.members.length} member${x.members.length === 1 ? "" : "s"}`} · ${sa ? `${LABEL[sa]} on ${d.share}` : `no group access to ${d.share}`}`}
                          value={g[x.name] ?? "none"}
                          onChange={(a) => setG(set(g, x.name, a))}
                        />
                      );
                    })}
              </div>
              <p className="text-xs text-zinc-500">
                Applies to everything inside {name}. People also need access to {d.share}, and get the lower of the two. Applies over SMB and WebDAV, not over NFS.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function set(m: Record<string, Access>, k: string, a: Access | "none") {
  const n = { ...m };
  if (a === "none") delete n[k];
  else n[k] = a;
  return n;
}

function Choice({ on, title, text, onClick }: { on: boolean; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition ring-inset",
        on ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5",
      )}
    >
      <span className={cx("mt-0.5 size-4 shrink-0 rounded-full border-[5px]", on ? "border-brand-600" : "border-zinc-300 dark:border-zinc-600")} />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="block text-[13px] text-zinc-500">{text}</span>
      </span>
    </button>
  );
}

function Row({
  icon,
  title,
  subtitle,
  value,
  max,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: Access | "none";
  max?: Access | null;
  onChange: (a: Access | "none") => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-white/5">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium break-words">{title}</div>
          <div className="text-xs break-words text-zinc-500">{subtitle}</div>
        </div>
      </div>
      <Segmented
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "none", label: "No access" },
          { value: "ro", label: "Read", tone: max === null ? "opacity-50" : "text-sky-700 dark:text-sky-300" },
          { value: "rw", label: "Read & write", tone: max === null || max === "ro" ? "opacity-50" : "text-emerald-700 dark:text-emerald-300" },
        ]}
      />
    </div>
  );
}
