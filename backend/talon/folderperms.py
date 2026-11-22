"""Folder permissions: who may open a folder inside a shared folder.

Files → a folder's ⋯ → Permissions: "Same as the shared folder" (the default) or
"Custom": only the users and groups listed get Read or Read & write, for the folder
and everything in it. People still need access to the shared folder to reach it,
and get the lower of the two.

Stored in the state (so it can be shown and re-applied) and applied as POSIX ACLs
(setfacl), which the kernel enforces for SMB; WebDAV checks the same rules. The
folder itself becomes owned by root and the NAS users group loses its access;
default ACLs make new files and folders inherit the rule. NFS clients, which Talon
maps to the NAS users group, cannot open custom folders."""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

from .util import UserError, run

ORDER = {"none": 0, "ro": 1, "rw": 2}


def has_default_acl(path: str) -> bool:
    """Is the folder governed by folder permissions (a default ACL)?"""
    try:
        return "system.posix_acl_default" in os.listxattr(path)
    except OSError:
        return False


def acl_entries(users: Dict[str, str], groups: Dict[str, str]) -> List[str]:
    perm = {"rw": "rwX", "ro": "r-X"}
    out = [f"u:{u}:{perm[a]}" for u, a in sorted(users.items()) if a in perm]
    out += [f"g:{g}:{perm[a]}" for g, a in sorted(groups.items()) if a in perm]
    return out


class FolderPerms:
    def __init__(self, nas, demo: bool = False):
        self.nas = nas
        self.demo = demo

    def rules(self) -> Dict[str, dict]:
        return self.nas.state.get("folder_perms") or {}

    @staticmethod
    def _key(volume: str, rel: str) -> str:
        return f"{volume}:{rel.strip('/')}"

    def _share_of(self, volume: str, rel: str) -> Optional[dict]:
        """The shared folder this folder is in (rel is relative to the volume)."""
        rel = rel.strip("/")
        best = None
        for s in self.nas.state.get("shares").values():
            if s["volume"] != volume:
                continue
            f = s["folder"].strip("/")
            if (rel == f or rel.startswith(f + "/")) and (not best or len(f) > len(best["folder"].strip("/"))):
                best = s
        return best

    def _user_groups(self, user: str) -> set:
        return set(next((u.get("groups", []) for u in self.nas.users() if u["name"] == user), []))

    def _rule_access(self, rule: dict, user: str, groups: set) -> str:
        best = rule.get("users", {}).get(user, "none")
        for g, a in rule.get("groups", {}).items():
            if (g == self.nas.cfg.users_group or g in groups) and ORDER.get(a, 0) > ORDER.get(best, 0):
                best = a
        return best

    # ------------------------------------------------------------ read
    def get(self, volume: str, path: str) -> dict:
        target, root = self.nas.files.resolve(volume, path)
        if not os.path.isdir(target):
            raise UserError("Permissions can be set on folders")
        rel = os.path.relpath(target, root)
        rel = "" if rel == "." else rel
        share = self._share_of(volume, rel)
        rules = self.rules()
        inherited = None
        parts = rel.split("/") if rel else []
        for i in range(len(parts) - 1, 0, -1):
            k = self._key(volume, "/".join(parts[:i]))
            if k in rules and share and len("/".join(parts[:i])) >= len(share["folder"].strip("/")):
                inherited = "/".join(parts[:i])
                break
        return {"volume": volume, "path": rel, "share": share["name"] if share else None,
                "share_root": bool(share) and rel == share["folder"].strip("/"),
                "share_users": share.get("users", {}) if share else {},
                "share_groups": share.get("groups", {}) if share else {},
                "custom": rules.get(self._key(volume, rel)), "inherited_from": inherited}

    def flags(self, volume: str, rel_dir: str) -> set:
        """Names of the folders in rel_dir that have custom permissions (for Files)."""
        prefix = self._key(volume, rel_dir)
        prefix = prefix + "/" if not prefix.endswith(":") else prefix
        return {k[len(prefix):] for k in self.rules() if k.startswith(prefix) and "/" not in k[len(prefix):]}

    # ------------------------------------------------------------ check (WebDAV)
    def effective(self, user: str, share_root: str, target: str, share_access: str) -> str:
        """The access a user has to target: the share's, narrowed by every custom
        folder on the way (the nearest one decides, the ones above must allow at least Read)."""
        rules = self.rules()
        if not rules:
            return share_access
        groups = None
        result = share_access
        for key, rule in rules.items():
            vol, _, rel = key.partition(":")
            try:
                folder, _r = self.nas.files.resolve(vol, rel, must_exist=False)
            except UserError:
                continue
            if target == folder or target.startswith(folder + os.sep):
                if groups is None:
                    groups = self._user_groups(user)
                a = self._rule_access(rule, user, groups)
                if ORDER[a] < ORDER[result]:
                    result = a
        return result

    # ------------------------------------------------------------ change
    def set(self, volume: str, path: str, data: dict, actor: str):
        info = self.get(volume, path)
        if not info["share"]:
            raise UserError("Folder permissions apply to folders inside a shared folder")
        if info["share_root"]:
            raise UserError("This is the shared folder itself: change its permissions under Shared Folders")
        rel = info["path"]
        key = self._key(volume, rel)
        custom = bool(data.get("custom"))
        users = {u: a for u, a in (data.get("users") or {}).items() if a in ("ro", "rw")}
        groups = {g: a for g, a in (data.get("groups") or {}).items() if a in ("ro", "rw")}
        known_users = {u["name"] for u in self.nas.users()}
        known_groups = set(self.nas.state.get("groups")) | {self.nas.cfg.users_group}
        bad = [u for u in users if u not in known_users] + [g for g in groups if g not in known_groups]
        if bad:
            raise UserError("Unknown user or group: " + ", ".join(bad))
        if custom and not users and not groups:
            raise UserError("Give at least one user or group access, or choose Same as the shared folder")
        rule = {"users": users, "groups": groups, "set_by": actor, "at": time.time()} if custom else None

        def upd(d):
            fp = d.setdefault("folder_perms", {})
            if rule:
                fp[key] = rule
            else:
                fp.pop(key, None)
        self.nas.state.update(upd)
        what = "custom permissions" if custom else "the shared folder's permissions"

        def work(log):
            self._apply(volume, rel, rule, log)
            # folders inside with their own rule: the recursive change above overwrote them
            for k, r in sorted(self.rules().items(), key=lambda kv: kv[0].count("/")):
                v, _, sub = k.partition(":")
                if v == volume and sub.startswith(rel + "/"):
                    self._apply(volume, sub, r, log)

        self.nas.state.log_activity(actor, f"Folder {info['share']}/{os.path.relpath(rel, self._share_of(volume, rel)['folder'].strip('/'))} now uses {what}",
                                    "info", "sharing")
        return self.nas.jobs.submit(f"Apply folder permissions to {os.path.basename(rel)}", actor, work)

    def _apply(self, volume: str, rel: str, rule: Optional[dict], log) -> None:
        if self.demo:
            log(f"(demo) {'setfacl ' + ','.join(acl_entries(rule['users'], rule['groups'])) if rule else 'setfacl -R -b'} {rel}")
            return
        path, _root = self.nas.files.resolve(volume, rel)
        ug = self.nas.cfg.users_group
        run(["setfacl", "-R", "-b", path], log=log)
        if not rule:
            # back to how Samba creates things: group NAS users can read and write
            run(["chgrp", "-R", ug, path], check=False, log=log)
            run(["chmod", "-R", "u+rwX,g+rwX,o+rX", path], log=log)
            run(["find", path, "-type", "d", "-exec", "chmod", "g+s", "{}", "+"], check=False, log=log)
            return
        entries = acl_entries(rule["users"], rule["groups"])
        run(["chown", f"root:{ug}", path], log=log)
        run(["chmod", "-R", "g-rwx,o-rwx", path], log=log)
        run(["chmod", "u+rwx", path], log=log)
        run(["setfacl", "-R", "-m", ",".join(entries), path], log=log)
        run(["find", path, "-type", "d", "-exec", "setfacl", "-d", "-m",
             ",".join(["u::rwx", "g::---", "o::---", "m::rwx"] + entries), "{}", "+"], log=log)

    # ------------------------------------------------------------ Files: renamed, moved, deleted
    def moved(self, volume: str, old_rel: str, new_volume: str, new_rel: str) -> None:
        old_rel, new_rel = old_rel.strip("/"), new_rel.strip("/")
        old_key = self._key(volume, old_rel)
        if not any(k == old_key or k.startswith(old_key + "/") for k in self.rules()):
            return

        def upd(d):
            fp = d.get("folder_perms") or {}
            for k in [k for k in fp if k == old_key or k.startswith(old_key + "/")]:
                fp[self._key(new_volume, new_rel + k[len(old_key):])] = fp.pop(k)
        self.nas.state.update(upd)

    def removed(self, volume: str, rel: str) -> None:
        key = self._key(volume, rel.strip("/"))
        if any(k == key or k.startswith(key + "/") for k in self.rules()):
            self.nas.state.update(lambda d: d.__setitem__("folder_perms", {
                k: v for k, v in (d.get("folder_perms") or {}).items() if not (k == key or k.startswith(key + "/"))}))
