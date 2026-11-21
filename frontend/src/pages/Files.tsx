import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  HardDrive,
  Download,
  File,
  FileArchive,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Image,
  MoreHorizontal,
  Move,
  Music,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Usb,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, cx, dateTime } from "../lib/format";
import { useAction } from "../lib/hooks";
import { Button, Card, ConfirmDialog, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, PageLoader, Progress, Select } from "../components/ui";

type Item = { name: string; folder: boolean; size: number; modified: number; count: number | null };
type Listing = { volume: string; path: string; items: Item[] };
type Loc = { id: string; kind: "volume" | "usb" | "disk" | "onedrive"; name: string; detail: string; mounted: boolean; ejectable: boolean };

function LocIcon({ kind, className }: { kind: Loc["kind"]; className?: string }) {
  const C = kind === "onedrive" ? Cloud : kind === "usb" ? Usb : kind === "disk" ? HardDrive : Database;
  return <C className={className} />;
}
type Upload = { id: number; name: string; size: number; sent: number; status: "waiting" | "uploading" | "done" | "error"; error?: string };

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

function FileIcon({ item }: { item: Item }) {
  if (item.folder) return <Folder className="size-4.5 shrink-0 fill-amber-100 text-amber-500 dark:fill-amber-500/20" />;
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  const cls = "size-4.5 shrink-0 text-zinc-400";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg", "tif", "tiff"].includes(ext)) return <Image className={cls} />;
  if (["mp4", "mkv", "mov", "avi", "webm", "m4v"].includes(ext)) return <Film className={cls} />;
  if (["mp3", "flac", "wav", "m4a", "aac", "ogg", "m3u"].includes(ext)) return <Music className={cls} />;
  if (["zip", "7z", "rar", "tar", "gz", "xz", "bz2"].includes(ext)) return <FileArchive className={cls} />;
  if (["txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "odt"].includes(ext)) return <FileText className={cls} />;
  return <File className={cls} />;
}

export default function FilesPage() {
  const qc = useQueryClient();
  const locs = useQuery({ queryKey: ["file-locations"], queryFn: () => api.get<Loc[]>("/files/locations"), refetchInterval: 15000 });
  const params = new URLSearchParams(location.search);
  const [volume, setVolume] = useState(params.get("volume") ?? "");
  const [path, setPath] = useState(params.get("path") ?? "");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<null | "folder" | "rename" | "move" | "delete">(null);
  const [target, setTarget] = useState<string[]>([]); // items an action applies to
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);   // a file's previous versions
  const [showBin, setShowBin] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const places = locs.data ?? [];
  const here = places.find((l) => l.id === volume);
  useEffect(() => {
    // start in the first location, or leave one that disappeared (ejected, disconnected)
    if (places.length && (!volume || !places.some((l) => l.id === volume))) {
      setVolume(places[0].id);
      setPath("");
    }
  }, [places.map((l) => l.id).join()]); // eslint-disable-line
  useEffect(() => {
    if (!volume) return;
    const q = new URLSearchParams({ volume, ...(path ? { path } : {}) });
    history.replaceState(null, "", `${location.pathname}?${q}`);
  }, [volume, path]);

  const list = useQuery({
    queryKey: ["files", volume, path],
    queryFn: () => api.get<Listing>(`/files?volume=${encodeURIComponent(volume)}&path=${encodeURIComponent(path)}`),
    enabled: !!volume,
  });
  // opening a disk mounts it: refresh the locations so Eject appears
  useEffect(() => {
    if (list.data && here && !here.mounted) qc.invalidateQueries({ queryKey: ["file-locations"] });
  }, [list.data]); // eslint-disable-line
  const items = useMemo(() => (list.data?.items ?? []).filter((i) => i.name.toLowerCase().includes(filter.toLowerCase())), [list.data, filter]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["files", volume] });

  const open = (p: string) => {
    setPath(p);
    setSel(new Set());
    setFilter("");
  };
  const openVolume = (v: string) => {
    setVolume(v);
    open("");
  };
  const act = (names: string[], d: typeof dialog) => {
    setTarget(names.map((n) => join(path, n)));
    setDialog(d);
  };
  const download = (rels: string[]) => {
    const q = new URLSearchParams([["volume", volume], ...rels.map((r) => ["item", r] as [string, string])]);
    const a = document.createElement("a");
    a.href = `/api/files/download?${q}`;
    a.click();
  };

  const remove = useAction(() => api.post<{ deleted: number }>("/files/delete", { volume, items: target }), {
    success: (r) => `${r.deleted} item${r.deleted === 1 ? "" : "s"} deleted`,
    onSuccess: () => {
      setDialog(null);
      setSel(new Set());
      refresh();
    },
  });

  /* ---------------------------------------------------------------- uploads */
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length || !volume) return;
    const base = Date.now();
    const queue: Upload[] = list.map((f, i) => ({ id: base + i, name: f.name, size: f.size, sent: 0, status: "waiting" }));
    setUploads((u) => [...u.filter((x) => x.status === "uploading" || x.status === "waiting"), ...queue]);
    const dest = { volume, path };
    for (let i = 0; i < list.length; i++) {
      const id = queue[i].id;
      const upd = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
      upd({ status: "uploading" });
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        const q = new URLSearchParams({ volume: dest.volume, path: dest.path, name: list[i].name });
        xhr.open("PUT", `/api/files/upload?${q}`);
        xhr.setRequestHeader("X-Requested-With", "talon");
        xhr.upload.onprogress = (e) => upd({ sent: e.loaded });
        xhr.onload = () => {
          if (xhr.status === 200) upd({ status: "done", sent: list[i].size });
          else {
            let msg = `HTTP ${xhr.status}`;
            try {
              msg = JSON.parse(xhr.responseText).detail ?? msg;
            } catch {
              /* keep the status */
            }
            upd({ status: "error", error: msg });
          }
          resolve();
        };
        xhr.onerror = () => {
          upd({ status: "error", error: "Connection lost" });
          resolve();
        };
        xhr.send(list[i]);
      });
    }
    qc.invalidateQueries({ queryKey: ["files", dest.volume] });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  const eject = useAction(() => api.post("/files/eject", { volume }), {
    success: () => `${here?.name ?? "Disk"} can be unplugged now`,
    invalidate: ["file-locations", "disks"],
    // leave the disk, or the next listing would mount it again
    onSuccess: () => {
      const next = places.find((l) => l.kind === "volume") ?? places.find((l) => l.id !== volume);
      if (next) openVolume(next.id);
    },
  });

  if (!locs.data) return <PageLoader />;
  const header = (
    <PageHeader
      title="Files"
      description="Browse, upload and download files on your volumes, disks and OneDrive."
      actions={
        volume ? (
          <>
            <Button icon={<FolderPlus className="size-4" />} onClick={() => setDialog("folder")}>
              New folder
            </Button>
            <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
              Upload
            </Button>
          </>
        ) : undefined
      }
    />
  );
  if (!places.length)
    return (
      <>
        {header}
        <Card>
          <Empty icon={<FolderTree className="size-6" />} title="No storage yet" text="Create a volume, plug in a disk or connect OneDrive." />
        </Card>
      </>
    );

  const parts = path.split("/").filter(Boolean);
  const selected = [...sel];
  const folders = items.filter((i) => i.folder).length;
  const toggle = (name: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <>
      {header}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Card
        className={cx("overflow-hidden transition", dragging && "ring-2 ring-brand-500")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {/* toolbar and selection actions share one fixed-height row, so a click
            that selects never moves the list under the pointer */}
        {selected.length > 0 ? (
          <div className="flex min-h-15 flex-wrap items-center gap-x-4 gap-y-1 border-b border-brand-100 bg-brand-50 px-5 py-2.5 text-[13px] dark:border-white/5 dark:bg-brand-500/10">
            <span className="font-semibold text-brand-800 dark:text-brand-200">{selected.length} selected</span>
            <button className="flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => download(selected.map((n) => join(path, n)))}>
              <Download className="size-3.5" /> Download
            </button>
            {selected.length === 1 && (
              <button className="flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => act(selected, "rename")}>
                <Pencil className="size-3.5" /> Rename
              </button>
            )}
            <button className="flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => act(selected, "move")}>
              <Move className="size-3.5" /> Move
            </button>
            <button className="flex items-center gap-1.5 font-medium text-rose-600 hover:underline dark:text-rose-400" onClick={() => act(selected, "delete")}>
              <Trash2 className="size-3.5" /> Delete
            </button>
            <button className="ml-auto flex items-center gap-1 text-brand-500" onClick={() => setSel(new Set())}>
              <X className="size-3.5" /> Clear
            </button>
          </div>
        ) : (
          <div className="flex min-h-15 flex-wrap items-center gap-3 border-b border-zinc-100 px-5 py-2.5 dark:border-white/5">
            <LocationPicker locs={places} value={volume} onChange={openVolume} />
            {here?.ejectable && (
              <Button size="sm" icon={<ArrowUpFromLine className="size-3.5" />} loading={eject.isPending} onClick={() => eject.mutate()}>
                Eject
              </Button>
            )}
            {/* the folder path inside the location; choosing the location again goes to its top */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13px]">
              {parts.map((p, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-zinc-400" />
                  {i === parts.length - 1 ? (
                    <span className="font-semibold">{p}</span>
                  ) : (
                    <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => open(parts.slice(0, i + 1).join("/"))}>
                      {p}
                    </button>
                  )}
                </span>
              ))}
            </div>
            {here?.kind === "volume" && (
              <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setShowBin(true)}>
                Recycle bin
              </Button>
            )}
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder" className="h-9 pl-9" />
            </div>
          </div>
        )}

        {list.isLoading ? (
          <div className="p-8">
            <PageLoader />
          </div>
        ) : items.length === 0 ? (
          <Empty icon={<FolderOpen className="size-6" />} title={filter ? "No matches" : "This folder is empty"} text={filter ? "Try another name." : "Drop files here or use Upload."} />
        ) : (
          <table className="w-full table-fixed text-sm select-none">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                <th className="w-12 py-2.5 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-brand-600"
                    checked={selected.length === items.length}
                    onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.name)) : new Set())}
                  />
                </th>
                <th className="py-2.5">Name</th>
                <th className="hidden w-32 px-3 py-2.5 sm:table-cell">Size</th>
                <th className="hidden w-40 px-3 py-2.5 md:table-cell">Modified</th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {items.map((it) => {
                const on = sel.has(it.name);
                return (
                  <tr
                    key={it.name}
                    onClick={(e) => (e.metaKey || e.ctrlKey ? toggle(it.name) : setSel(on && sel.size === 1 ? new Set() : new Set([it.name])))}
                    onDoubleClick={() => (it.folder ? open(join(path, it.name)) : download([join(path, it.name)]))}
                    className={cx("h-11 cursor-pointer", on ? "bg-brand-50/60 dark:bg-brand-500/10" : "hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]")}
                  >
                    <td className="pl-5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${it.name}`} className="size-4 accent-brand-600" checked={on} onChange={() => toggle(it.name)} />
                    </td>
                    <td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <FileIcon item={it} />
                        <span className={cx("truncate", it.folder && "font-medium")} title={it.name}>
                          {it.name}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-3 whitespace-nowrap text-zinc-500 sm:table-cell">{it.folder ? `${it.count} item${it.count === 1 ? "" : "s"}` : bytes(it.size)}</td>
                    <td className="hidden px-3 whitespace-nowrap text-zinc-500 md:table-cell" title={dateTime(it.modified)}>
                      {ago(it.modified)}
                    </td>
                    <td className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={
                          <IconButton label={`Actions for ${it.name}`} className="size-8">
                            <MoreHorizontal className="size-4.5" />
                          </IconButton>
                        }
                      >
                        {it.folder && (
                          <MenuItem icon={<FolderOpen />} onClick={() => open(join(path, it.name))}>
                            Open
                          </MenuItem>
                        )}
                        <MenuItem icon={<Download />} onClick={() => download([join(path, it.name)])}>
                          Download
                        </MenuItem>
                        <MenuItem icon={<Pencil />} onClick={() => act([it.name], "rename")}>
                          Rename
                        </MenuItem>
                        {!it.folder && here?.kind === "volume" && (
                          <MenuItem icon={<RotateCcw />} onClick={() => setVersionsOf(join(path, it.name))}>
                            Previous versions
                          </MenuItem>
                        )}
                        <MenuItem icon={<Move />} onClick={() => act([it.name], "move")}>
                          Move
                        </MenuItem>
                        <MenuItem icon={<Trash2 />} danger onClick={() => act([it.name], "delete")}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 text-[13px] text-zinc-500 dark:border-white/5">
          <span>
            {folders} folder{folders === 1 ? "" : "s"} · {items.length - folders} file{items.length - folders === 1 ? "" : "s"} · {bytes(items.reduce((a, i) => a + i.size, 0))}
          </span>
          <span className="hidden sm:inline">Drop files here to upload. Double-click a folder to open it.</span>
        </div>
      </Card>

      {dialog === "folder" && <NameDialog title="New folder" label="Folder name" initial="" confirm="Create" onClose={() => setDialog(null)} onSubmit={(name) => api.post("/files/folder", { volume, path, name })} onDone={refresh} />}
      {dialog === "rename" && (
        <NameDialog
          title="Rename"
          label="New name"
          initial={target[0].split("/").pop() ?? ""}
          confirm="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => api.post("/files/rename", { volume, path: target[0], name })}
          onDone={() => {
            setSel(new Set());
            refresh();
          }}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          volumes={places.filter((l) => (l.kind === "onedrive") === (here?.kind === "onedrive"))}
          volume={volume}
          start={path}
          items={target}
          onClose={() => setDialog(null)}
          onDone={() => {
            setSel(new Set());
            qc.invalidateQueries({ queryKey: ["files"] });
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        danger
        title={target.length === 1 ? `Delete ${target[0].split("/").pop()}?` : `Delete ${target.length} items?`}
        confirmText="Delete"
        message="Folders are deleted with everything inside them. This cannot be undone."
      />
      {versionsOf && <VersionsDialog volume={volume} path={versionsOf} onClose={() => setVersionsOf(null)} onDone={refresh} />}
      {showBin && <RecycleBin volume={volume} name={here?.name ?? volume} onClose={() => setShowBin(false)} onDone={refresh} />}
      {uploads.length > 0 && <UploadPanel uploads={uploads} where={`${here?.name ?? volume}${path ? "/" + path : ""}`} onClose={() => setUploads((u) => u.filter((x) => x.status === "uploading" || x.status === "waiting"))} />}
    </>
  );
}

/* ====================================================================== dialogs */

type Version = { id: string; time: number; size: number; expires: number };

/** Earlier copies of a file kept when a OneDrive backup replaced it. */
function VersionsDialog({ volume, path, onClose, onDone }: { volume: string; path: string; onClose: () => void; onDone: () => void }) {
  const q = useQuery({
    queryKey: ["versions", volume, path],
    queryFn: () => api.get<Version[]>(`/files/versions?${new URLSearchParams({ volume, path })}`),
  });
  const restore = useAction(
    (id: string) => api.post("/files/versions/restore", { volume, path, id }),
    { success: "Version restored", invalidate: ["versions"], onSuccess: onDone },
  );
  const name = path.split("/").pop();
  return (
    <Modal open onClose={onClose} title="Previous versions" description={name} footer={<Button onClick={onClose}>Close</Button>}>
      {!q.data ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : q.data.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">
          No previous versions. When a OneDrive backup replaces this file, the old copy is kept here for 30 days.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {q.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{dateTime(v.time)}</div>
                  <div className="text-xs text-zinc-500">
                    {bytes(v.size)} · kept until {dateTime(v.expires).split(" ")[0]}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = `/api/files/versions/download?${new URLSearchParams({ volume, id: v.id })}`;
                      a.click();
                    }}
                  >
                    Download
                  </Button>
                  <Button size="sm" variant="primary" loading={restore.isPending && restore.variables === v.id} onClick={() => restore.mutate(v.id)}>
                    Restore
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">Restore puts that version back; the current file becomes a previous version, so nothing is lost.</p>
        </>
      )}
    </Modal>
  );
}

type BinItem = { id: string; name: string; was_in: string; by: string; deleted: number; size: number };

/** Files deleted from a computer (shared folders with the recycle bin on) or by a OneDrive backup. */
function RecycleBin({ volume, name, onClose, onDone }: { volume: string; name: string; onClose: () => void; onDone: () => void }) {
  const q = useQuery({
    queryKey: ["recycle-bin", volume],
    queryFn: () => api.get<{ items: BinItem[]; total: number; keep_days: number }>(`/files/bin?${new URLSearchParams({ volume })}`),
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const restore = useAction(
    (ids: string[]) => api.post<{ restored: number }>("/files/bin/restore", { volume, ids }),
    {
      success: (r) => `${r.restored} item${r.restored === 1 ? "" : "s"} restored`,
      invalidate: ["recycle-bin"],
      onSuccess: () => {
        setSel(new Set());
        onDone();
      },
    },
  );
  const empty = useAction(() => api.post<{ deleted: number }>("/files/bin/delete", { volume }), {
    success: "Recycle bin emptied",
    invalidate: ["recycle-bin"],
    onSuccess: () => setConfirmEmpty(false),
  });
  const items = q.data?.items ?? [];
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
      title={`Recycle bin · ${name}`}
      description={`Deleted files are kept for ${q.data?.keep_days ?? 30} days, then removed for good`}
      footer={
        <>
          <Button variant="ghost" disabled={!items.length} onClick={() => setConfirmEmpty(true)} className="mr-auto text-rose-600 dark:text-rose-400">
            Empty recycle bin
          </Button>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!sel.size} loading={restore.isPending} onClick={() => restore.mutate([...sel])}>
            Restore{sel.size ? ` ${sel.size}` : ""}
          </Button>
        </>
      }
    >
      {!q.data ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : items.length === 0 ? (
        <Empty icon={<Trash2 className="size-6" />} title="The recycle bin is empty" text="Files deleted from Windows or macOS, or by a OneDrive backup, appear here." />
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-600" checked={sel.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Select ${it.name}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.name}</div>
                <div className="truncate text-xs text-zinc-500">
                  {it.was_in === "." ? name : it.was_in} · {it.by} · {dateTime(it.deleted)} · {bytes(it.size)}
                </div>
              </div>
              <Button size="sm" loading={restore.isPending && restore.variables?.[0] === it.id && restore.variables.length === 1} onClick={() => restore.mutate([it.id])}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.total > items.length && (
        <p className="mt-2 text-xs text-zinc-500">Showing the newest {items.length} of {q.data.total}.</p>
      )}
      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() => empty.mutate()}
        loading={empty.isPending}
        danger
        title="Empty the recycle bin?"
        confirmText="Empty"
        message={`All ${q.data?.total ?? 0} items are deleted for good. This cannot be undone.`}
      />
    </Modal>
  );
}

function NameDialog({
  title,
  label,
  initial,
  confirm,
  onClose,
  onSubmit,
  onDone,
}: {
  title: string;
  label: string;
  initial: string;
  confirm: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const go = useAction(() => onSubmit(name.trim()), {
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const ok = !!name.trim() && name.trim() !== initial;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={go.isPending} onClick={() => go.mutate()}>
            {confirm}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && go.mutate()} autoFocus />
      </Field>
    </Modal>
  );
}

function MoveDialog({ volumes, volume, start, items, onClose, onDone }: { volumes: Loc[]; volume: string; start: string; items: string[]; onClose: () => void; onDone: () => void }) {
  const [vol, setVol] = useState(volume);
  const [path, setPath] = useState(start);
  const [picked, setPicked] = useState<string | null>(null); // a selected subfolder
  const openDir = (p: string) => {
    setPath(p);
    setPicked(null);
  };
  const q = useQuery({
    queryKey: ["files", vol, path],
    queryFn: () => api.get<Listing>(`/files?volume=${encodeURIComponent(vol)}&path=${encodeURIComponent(path)}`),
  });
  const folders = (q.data?.items ?? []).filter((i) => i.folder && !(vol === volume && items.includes(join(path, i.name))));
  const parts = path.split("/").filter(Boolean);
  const dest = picked ? join(path, picked) : path;
  const move = useAction(() => api.post<{ moved: number }>("/files/move", { volume, items, dest_volume: vol, dest }), {
    success: (r) => `${r.moved} item${r.moved === 1 ? "" : "s"} moved`,
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const same = vol === volume && dest === start;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Move ${items.length === 1 ? items[0].split("/").pop() : `${items.length} items`}`}
      description="Click to select. Double-click a folder to open it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={same} loading={move.isPending} onClick={() => move.mutate()}>
            {picked ? "Move" : "Move here"}
          </Button>
        </>
      }
    >
      {volumes.length > 1 && (
        <div className="mb-4">
          <Field label="Location">
            <Select
              value={vol}
              onChange={(e) => {
                setVol(e.target.value);
                openDir("");
              }}
            >
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => openDir("")}>
          {volumes.find((v) => v.id === vol)?.name ?? vol}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-zinc-400" />
            <button className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => openDir(parts.slice(0, i + 1).join("/"))}>
              {p}
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 ring-zinc-200 select-none dark:divide-white/5 dark:ring-white/10">
        {folders.length ? (
          folders.map((f) => {
            const on = picked === f.name;
            return (
              <div
                key={f.name}
                role="button"
                tabIndex={0}
                onClick={() => setPicked(on ? null : f.name)}
                onDoubleClick={() => openDir(join(path, f.name))}
                onKeyDown={(e) => e.key === "Enter" && openDir(join(path, f.name))}
                className={cx(
                  "flex min-h-11 py-2 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left text-sm",
                  on ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
                )}
              >
                <FolderOpen className="size-4 shrink-0 text-amber-500" />
                <span className={cx("truncate", on && "font-medium")}>{f.name}</span>
                <IconButton
                  label={`Open ${f.name}`}
                  className="ml-auto size-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDir(join(path, f.name));
                  }}
                >
                  <ChevronRight className="size-4" />
                </IconButton>
              </div>
            );
          })
        ) : (
          <div className="px-3.5 py-3 text-[13px] text-zinc-500">No subfolders.</div>
        )}
      </div>
    </Modal>
  );
}

function UploadPanel({ uploads, where, onClose }: { uploads: Upload[]; where: string; onClose: () => void }) {
  const busy = uploads.some((u) => u.status === "uploading" || u.status === "waiting");
  return (
    <div className="fixed right-4 bottom-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">
          {busy ? "Uploading" : "Uploaded"} to {where}
        </span>
        <IconButton label="Close" className="size-7" disabled={busy} onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <ul className="max-h-60 space-y-2.5 overflow-y-auto text-[13px]">
        {uploads.map((u) => (
          <li key={u.id}>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">{u.name}</span>
              <span className={cx("shrink-0", u.status === "error" ? "text-rose-600" : u.status === "done" ? "text-emerald-600" : "text-zinc-500")} title={u.error}>
                {u.status === "uploading" ? `${Math.round((u.sent / Math.max(u.size, 1)) * 100)}%` : u.status === "done" ? "Done" : u.status === "error" ? "Failed" : "Waiting"}
              </span>
            </div>
            {u.status === "uploading" && <Progress value={(u.sent / Math.max(u.size, 1)) * 100} tone="blue" className="mt-1 h-1" />}
            {u.status === "error" && <div className="truncate text-xs text-rose-600">{u.error}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The current location; the menu lists volumes, other disks and OneDrive. */
function LocationPicker({ locs, value, onChange }: { locs: Loc[]; value: string; onChange: (id: string) => void }) {
  const cur = locs.find((l) => l.id === value);
  const groups: [string, Loc[]][] = [
    ["Volumes", locs.filter((l) => l.kind === "volume")],
    ["Other disks", locs.filter((l) => l.kind === "usb" || l.kind === "disk")],
    ["Cloud", locs.filter((l) => l.kind === "onedrive")],
  ];
  return (
    <Menu
      align="left"
      trigger={
        <button className="flex h-9 items-center gap-2 rounded-xl bg-zinc-100 px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-zinc-200/70 dark:bg-white/5 dark:hover:bg-white/10">
          {cur && <LocIcon kind={cur.kind} className="size-4 text-zinc-500" />}
          {cur?.name ?? "Choose"}
          <ChevronDown className="size-3.5 text-zinc-400" />
        </button>
      }
    >
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list], gi) => (
          <div key={title} className={cx(gi > 0 && "mt-1 border-t border-zinc-100 pt-1 dark:border-white/5")}>
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">{title}</div>
            {list.map((l) => (
              <MenuItem key={l.id} icon={<LocIcon kind={l.kind} />} onClick={() => onChange(l.id)}>
                <span className={cx("flex min-w-56 items-center justify-between gap-6", l.id === value && "text-brand-700 dark:text-brand-300")}>
                  <span className="truncate">{l.name}</span>
                  <span className="text-xs font-normal whitespace-nowrap text-zinc-400">{l.detail}</span>
                </span>
              </MenuItem>
            ))}
          </div>
        ))}
    </Menu>
  );
}
