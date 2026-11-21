import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users as UsersIcon, UserX } from "lucide-react";
import { api } from "../lib/api";
import { cx, sameSet } from "../lib/format";
import { useAction } from "../lib/hooks";
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

export default function UsersPage() {
  const [tab, setTab] = useState<"users" | "groups">("users");
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<{ user: string }>("/auth/me") });
  const [userDlg, setUserDlg] = useState<{ user: User | null } | null>(null);
  const [groupDlg, setGroupDlg] = useState<{ group: Group | null } | null>(null);
  const [delUser, setDelUser] = useState<User | null>(null);
  const [delGroup, setDelGroup] = useState<Group | null>(null);
  const removeUser = useAction((n: string) => api.del(`/users/${n}`), { success: "User deleted", invalidate: ["users", "groups"], onSuccess: () => setDelUser(null) });
  const removeGroup = useAction((n: string) => api.del(`/groups/${n}`), { success: "Group deleted", invalidate: ["groups", "users"], onSuccess: () => setDelGroup(null) });
  const toggle = useAction((u: User) => api.put(`/users/${u.name}`, { disabled: !u.disabled }), {
    success: (_r, u) => (u.disabled ? `${u.name} enabled` : `${u.name} disabled`),
    invalidate: ["users"],
  });
  if (!users.data || !groups.data) return <PageLoader />;

  return (
    <>
      <PageHeader
        title="Users & groups"
        description="Accounts for shared folders and this web interface."
        actions={
          tab === "users" ? (
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setUserDlg({ user: null })}>
              Add user
            </Button>
          ) : (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setGroupDlg({ group: null })}>
              Add group
            </Button>
          )
        }
      />
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "users", label: <>Users <Badge>{users.data.length}</Badge></> },
            { value: "groups", label: <>Groups <Badge>{groups.data.length}</Badge></> },
          ]}
        />
      </div>

      {tab === "users" && (
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

      {tab === "groups" &&
        (groups.data.length === 0 ? (
          <Card>
            <Empty
              icon={<UsersIcon className="size-6" />}
              title="No groups"
              text="Give several users the same access to shared folders."
              action={
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setGroupDlg({ group: null })}>
                  Add group
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.data.map((g) => (
              <Card key={g.name} className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                      <UsersIcon className="size-5" />
                    </div>
                    <div>
                      <div className="font-semibold">@{g.name}</div>
                      <div className="text-xs text-zinc-500">{g.members.length} member(s)</div>
                    </div>
                  </div>
                  <div className="flex">
                    <IconButton label="Edit" onClick={() => setGroupDlg({ group: g })}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="Delete" onClick={() => setDelGroup(g)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {g.members.length ? g.members.map((m) => <Badge key={m}>{m}</Badge>) : <span className="text-xs text-zinc-400">No members</span>}
                </div>
              </Card>
            ))}
          </div>
        ))}

      {userDlg && <UserDialog user={userDlg.user} groups={groups.data} isSelf={userDlg.user?.name === me.data?.user} onClose={() => setUserDlg(null)} />}
      {groupDlg && <GroupDialog group={groupDlg.group} users={users.data} onClose={() => setGroupDlg(null)} />}
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
      <ConfirmDialog
        open={!!delGroup}
        onClose={() => setDelGroup(null)}
        onConfirm={() => delGroup && removeGroup.mutate(delGroup.name)}
        loading={removeGroup.isPending}
        danger
        title={`Delete group @${delGroup?.name}?`}
        confirmText="Delete group"
        message="Members lose any share access granted through this group."
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

function GroupDialog({ group, users, onClose }: { group: Group | null; users: User[]; onClose: () => void }) {
  const isNew = !group;
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const err = name && !/^[a-z_][a-z0-9_-]{0,31}$/.test(name) ? "Lowercase letters, digits, - and _" : null;
  const save = useAction(() => (isNew ? api.post("/groups", { name, members }) : api.put(`/groups/${group!.name}`, { members })), {
    success: isNew ? `Group ${name} created` : "Group saved",
    invalidate: ["groups", "users"],
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add group" : `Edit @${group!.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name || !!err || (!isNew && sameSet(members, group!.members))}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {isNew ? "Create group" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Group name" error={err}>
          <Input value={name} disabled={!isNew} onChange={(e) => setName(e.target.value.toLowerCase())} />
        </Field>
        <div>
          <div className="mb-2 text-[13px] font-medium">Members</div>
          <div className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
            {users.map((u) => (
              <label key={u.name} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                <input
                  type="checkbox"
                  className="size-4 rounded accent-brand-600"
                  checked={members.includes(u.name)}
                  onChange={(e) => setMembers(e.target.checked ? [...members, u.name] : members.filter((m) => m !== u.name))}
                />
                <span className="text-sm font-medium">{u.name}</span>
                <span className="text-xs text-zinc-500">{u.full_name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
