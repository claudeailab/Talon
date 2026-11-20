from talon import sharecfg

VOLS = {"tank": {"mountpoint": "/srv/nas/tank"}}


def share(**kw):
    s = {"name": "S", "volume": "tank", "folder": "S", "description": "", "guest": "none",
         "users": {}, "groups": {}, "smb": {"enabled": True, "browseable": True},
         "nfs": {"enabled": False, "clients": [], "squash": "all"}}
    s.update(kw)
    return s


def test_smb_no_permissions_denies_everyone():
    conf = sharecfg.smb_conf({}, {"S": share()}, VOLS)
    assert "valid users = nobody" in conf


def test_smb_guest_and_lists():
    conf = sharecfg.smb_conf({}, {"S": share(guest="ro", users={"a": "rw", "b": "ro"},
                                             groups={"g": "rw"})}, VOLS)
    assert "guest ok = yes" in conf
    assert "valid users" not in conf.split("[S]")[1]
    assert "write list = a @g" in conf


def test_nfs_squash():
    s = share(nfs={"enabled": True, "squash": "all",
                   "clients": [{"host": "10.0.0.0/8", "access": "ro"}]})
    out = sharecfg.nfs_exports({"S": s}, VOLS, 1001)
    assert "/srv/nas/tank/S 10.0.0.0/8(ro,sync,no_subtree_check,all_squash,anonuid=65534,anongid=1001)" in out
