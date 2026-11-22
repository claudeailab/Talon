import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users as UsersIcon, UserX } from "lucide-react";
import { api } from "../lib/api";
import { cx, sameSet } from "../lib/format";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { Group, User } from "../lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  Modal,
  PageHeader,
  PageLoader,
  Tabs,
  ToggleRow,
} from "../components/ui";

type EntraUser = { oid: string; name: string; upn: string; email: string; web: boolean; added: number; added_by: string };
type Person = { id: string; name: string; upn: string; email: string; enabled: boolean; added: boolean };

export default function UsersPage() {
  const [tab, setTab] = useState<"local" | "entra">("local");
  const entra = useQuery({ queryKey: ["entra-users"], queryFn: () => api.get<{ ready: boolean; configured: boolean; users: EntraUser[] }>("/entra/users") });
  const [addEntra, setAddEntra] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<{ user: string }>("/auth/me") });
  const [userDlg, setUserDlg] = useState<{ user: User | null } | null>(null);
  const [delUser, setDelUser] = useState<User | null>(null);
  const removeUser = useAction((n: string) => api.del(`/users/${n}`), { success: "User deleted", invalidate: ["users", "groups"], onSuccess: () => setDelUser(null) });
  const toggle = useAction((u: User) => api.put(`/users/${u.name}`, { disabled: !u.disabled }), {
    success: (_r, u) => (u.disabled ? `${u.name} enabled` : `${u.name} disabled`),
    invalidate: ["users"],
  });
  if (!users.data || !groups.data || !entra.data) return <PageLoader />;
  // the EntraID Users tab appears once the EntraID app is set up; choosing people
  // needs the app to be set up for one organization (see EntraSetupNeeded)
  const view = entra.data.configured ? tab : "local";

  return (
    <>
      <PageHeader
        title="Users & Groups"
        description="Accounts for shared folders and this web interface."
        actions={
          view === "local" || !entra.data.ready ? (
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setUserDlg({ user: null })}>
              Add user
            </Button>
          ) : (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddEntra(true)}>
              Add EntraID users
            </Button>
          )
        }
      />
      {entra.data.configured && (
        <div className="mb-5">
          <Tabs
            value={view}
            onChange={setTab}
            tabs={[
              { value: "local", label: <>Local Users <Badge>{users.data.length}</Badge></> },
              { value: "entra", label: <>EntraID Users <Badge>{entra.data.users.length}</Badge></> },
            ]}
          />
        </div>
      )}

      {view === "entra" &&
        (entra.data.ready ? (
          <EntraUsersTab users={entra.data.users} me={me.data?.user} onAdd={() => setAddEntra(true)} />
        ) : (
          <EntraSetupNeeded />
        ))}
      {addEntra && <AddEntraDialog onClose={() => setAddEntra(false)} />}

      {view === "local" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                  <th className="px-5 py-3">User</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Role</th>
                  <th className="hidden px-3 py-3 md:table-cell">Groups</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {users.data.map((u) => (
                  <tr key={u.name} className="transition hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cx(
                            "flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white uppercase",
                            u.admin ? "bg-gradient-to-br from-brand-500 to-violet-500" : "bg-gradient-to-br from-sky-500 to-cyan-500",
                            u.disabled && "opacity-40 grayscale",
                          )}
                        >
                          {u.name[0]}
                        </div>
                        <div>
                          <div className="flex items-center gap-1 font-medium">
                            {u.name} {u.name === me.data?.user && <span className="text-xs text-zinc-400">(you)</span>}
                            {u.admin && <ShieldCheck className="size-3.5 text-brand-500 sm:hidden" aria-label="Administrator" />}
                          </div>
                          <div className="text-xs text-zinc-500">{u.full_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      {u.admin ? (
                        <Badge tone="violet">
                          <ShieldCheck className="size-3" /> Administrator
                        </Badge>
                      ) : (
                        <Badge>User</Badge>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {u.groups.length ? u.groups.map((g) => <Badge key={g}>@{g}</Badge>) : <span className="text-xs text-zinc-400">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.disabled ? (
                        <Badge tone="red" dot>
                          Disabled
                        </Badge>
                      ) : !u.smb ? (
                        <Badge tone="amber" dot>
                          Set password for SMB
                        </Badge>
                      ) : (
                        <Badge tone="green" dot>
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Menu
                        trigger={
                          <IconButton label="User actions">
                            <MoreHorizontal className="size-5" />
                          </IconButton>
                        }
                      >
                        <MenuItem icon={<Pencil />} onClick={() => setUserDlg({ user: u })}>
                          Edit
                        </MenuItem>
                        <MenuItem icon={<UserX />} disabled={u.name === me.data?.user} onClick={() => toggle.mutate(u)}>
                          {u.disabled ? "Enable" : "Disable"}
                        </MenuItem>
                        <MenuItem icon={<Trash2 />} danger disabled={u.name === me.data?.user} onClick={() => setDelUser(u)}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {userDlg && <UserDialog user={userDlg.user} groups={groups.data} isSelf={userDlg.user?.name === me.data?.user} onClose={() => setUserDlg(null)} />}
      <ConfirmDialog
        open={!!delUser}
        onClose={() => setDelUser(null)}
        onConfirm={() => delUser && removeUser.mutate(delUser.name)}
        loading={removeUser.isPending}
        danger
        title={`Delete user ${delUser?.name}?`}
        confirmText="Delete user"
        message="The account is removed and its share permissions are revoked. Files the user created stay on the volumes."
      />
    </>
  );
}

function UserDialog({ user, groups, isSelf, onClose }: { user: User | null; groups: Group[]; isSelf: boolean; onClose: () => void }) {
  const isNew = !user;
  const [name, setName] = useState(user?.name ?? "");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [sel, setSel] = useState<string[]>(user?.groups ?? []);
  const nameErr = name && !/^[a-z_][a-z0-9_-]{0,31}$/.test(name) ? "Lowercase letters, digits, - and _" : null;
  const pwErr = pw && pw.length < 8 ? "At least 8 characters" : pw2 && pw !== pw2 ? "Passwords do not match" : null;
  const save = useAction(
    () =>
      isNew
        ? api.post("/users", { name, full_name: fullName, password: pw, admin, groups: sel })
        : api.put(`/users/${user!.name}`, { full_name: fullName, admin, groups: sel, ...(pw ? { password: pw } : {}) }),
    { success: isNew ? `User ${name} created` : "User saved", invalidate: ["users", "groups"], onSuccess: onClose },
  );
  const valid = !!name && !nameErr && !pwErr && (isNew ? pw.length >= 8 && pw === pw2 : !pw || pw === pw2);
  const changed =
    isNew || fullName !== user!.full_name || admin !== user!.admin || !sameSet(sel, user!.groups) || pw !== "";
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add user" : `Edit ${user!.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || !changed} loading={save.isPending} onClick={() => save.mutate()}>
            {isNew ? "Create user" : "Save"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} autoComplete="off">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User name" error={nameErr}>
            <Input value={name} disabled={!isNew} onChange={(e) => setName(e.target.value.toLowerCase())} autoComplete="off" />
          </Field>
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={isNew ? "Password" : "New password"} error={pwErr} hint={isNew ? "Used for SMB access" : "Leave empty to keep the current password"}>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <div className="rounded-xl px-4 ring-1 ring-zinc-200 dark:ring-white/10">
          <ToggleRow
            title="Administrator"
            description="Can sign in to this web interface and manage the NAS."
            checked={admin}
            disabled={isSelf}
            onChange={setAdmin}
          />
        </div>
        {groups.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] font-medium">Groups</div>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const on = sel.includes(g.name);
                return (
                  <button
                    type="button"
                    key={g.name}
                    onClick={() => setSel(on ? sel.filter((x) => x !== g.name) : [...sel, g.name])}
                    className={cx(
                      "rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 transition",
                      on ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/30" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5",
                    )}
                  >
                    @{g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}


/** People from EntraID who may use Talon. Their name and password stay in EntraID;
 * here you only choose whether they may sign in to this web interface. */
function EntraUsersTab({ users, me, onAdd }: { users: EntraUser[]; me?: string; onAdd: () => void }) {
  const [edit, setEdit] = useState<EntraUser | null>(null);
  const [del, setDel] = useState<EntraUser | null>(null);
  const remove = useAction((oid: string) => api.del(`/entra/users/${oid}`), {
    success: "EntraID user removed",
    invalidate: ["entra-users"],
    onSuccess: () => setDel(null),
  });
  if (!users.length)
    return (
      <Card>
        <Empty
          icon={<UsersIcon className="size-6" />}
          title="No EntraID users yet"
          text="Choose people from your organization's EntraID directory."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={onAdd}>
              Add EntraID users
            </Button>
          }
        />
      </Card>
    );
  return (
    <>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
              <th className="px-5 py-3">User</th>
              <th className="px-3 py-3">Web interface</th>
              <th className="w-12 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {users.map((u) => (
              <tr key={u.oid}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white uppercase">
                      {(u.name || u.upn)[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {u.name} {u.upn === me && <span className="text-xs text-zinc-400">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-zinc-500">{u.upn}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  {u.web ? (
                    <Badge tone="violet">
                      <ShieldCheck className="size-3" /> Can sign in
                    </Badge>
                  ) : (
                    <Badge>No access</Badge>
                  )}
                </td>
                <td className="px-3 py-3">
                  <Menu
                    trigger={
                      <IconButton label={`Actions for ${u.upn}`}>
                        <MoreHorizontal className="size-5" />
                      </IconButton>
                    }
                  >
                    <MenuItem icon={<Pencil />} onClick={() => setEdit(u)}>
                      Edit
                    </MenuItem>
                    <MenuItem icon={<Trash2 />} danger disabled={u.upn === me} onClick={() => setDel(u)}>
                      Remove
                    </MenuItem>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <EntraUserDialog user={edit} isSelf={edit.upn === me} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.oid)}
        loading={remove.isPending}
        danger
        title={`Remove ${del?.name}?`}
        confirmText="Remove"
        message="They can no longer use Talon. Their account in EntraID is not changed."
      />
    </>
  );
}

function EntraUserDialog({ user, isSelf, onClose }: { user: EntraUser; isSelf: boolean; onClose: () => void }) {
  const [web, setWeb] = useState(user.web);
  const save = useAction(() => api.put(`/entra/users/${user.oid}`, { web }), {
    success: "Saved",
    invalidate: ["entra-users"],
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={user.name}
      description={user.upn}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={web === user.web} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[13px] text-zinc-500">The name and password are managed in EntraID.</p>
      <ToggleRow
        title="Web interface"
        description="Can sign in to this web interface with Sign in with Microsoft and manage the NAS"
        checked={web}
        disabled={isSelf}
        onChange={setWeb}
      />
    </Modal>
  );
}

/** Browse the EntraID directory and add people to Talon. */
function AddEntraDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dir = useQuery({ queryKey: ["entra-directory"], queryFn: () => api.get<Person[]>("/entra/directory") });
  const add = useAction(() => api.post<{ added: number }>("/entra/users", { ids: [...sel] }), {
    success: (r) => `${r.added} user${r.added === 1 ? "" : "s"} added`,
    invalidate: ["entra-users", "entra-directory"],
    onSuccess: onClose,
  });
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const people = (dir.data ?? []).filter((p) => words.every((w) => `${p.name} ${p.upn} ${p.email}`.toLowerCase().includes(w)));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add EntraID users"
      description="Choose people from your organization's directory"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!sel.size} loading={add.isPending} onClick={() => add.mutate()}>
            Add{sel.size ? ` ${sel.size}` : ""}
          </Button>
        </>
      }
    >
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" aria-label="Search" className="mb-3" />
      {dir.isLoading ? (
        <PageLoader />
      ) : dir.error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{(dir.error as Error).message}</p>
      ) : people.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Nobody found.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
          {people.map((p) => (
            <li key={p.id}>
              <label className={cx("flex items-center gap-3 px-3.5 py-2.5", p.added ? "opacity-60" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/[0.03]")}>
                <input type="checkbox" className="size-4 shrink-0 accent-brand-600" disabled={p.added} checked={p.added || sel.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{p.upn}</span>
                </span>
                {p.added ? <Badge>Added</Badge> : !p.enabled ? <Badge tone="amber">Disabled in EntraID</Badge> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** The EntraID app is set up for personal or any accounts: there is no directory
 * of people to choose from until it is set up for one organization. */
function EntraSetupNeeded() {
  return (
    <Card className="p-5">
      <div className="text-[15px] font-semibold">Set up the EntraID app for your organization</div>
      <p className="mt-1 text-sm text-zinc-500">To choose people from your organization's directory, Talon needs two changes:</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>
          In <b>Settings → EntraID</b>, set <b>Supported account types</b> to <b>Only my organization</b> and enter your <b>Directory (tenant) ID</b>{" "}
          (on the app's Overview page in the Entra portal). Then click <b>Save</b>.
        </li>
        <li>
          In the Entra portal, open the app's <b>API permissions → Add a permission → Microsoft Graph → Application permissions</b>, add <b>User.Read.All</b>{" "}
          and click <b>Grant admin consent</b>.
        </li>
      </ol>
      <p className="mt-3 text-[13px] text-zinc-500">OneDrive keeps working with a work or school account. Personal Microsoft accounts cannot be used with &quot;Only my organization&quot;.</p>
      <div className="mt-4">
        <Button variant="primary" onClick={() => navigate("/settings?tab=entra")}>Open Settings → EntraID</Button>
      </div>
    </Card>
  );
}
