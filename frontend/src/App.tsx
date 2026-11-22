import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType } from "react";
import {
  Activity as ActivityIcon,
  Bell,
  ChevronsUpDown,
  Cloud,
  Database,
  FolderOpen,
  FolderTree,
  HardDrive,
  LayoutDashboard,
  Layers,
  Loader2,
  LogOut,
  Clock,
  BookOpen,
  Mail,
  Menu as MenuIcon,
  Moon,
  Power,
  RotateCcw,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  DatabaseBackup,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { api, setUnauthorizedHandler } from "./lib/api";
import type { Settings } from "./lib/types";
import { cx, setFormats } from "./lib/format";
import { useTheme } from "./lib/hooks";
import { Link, navigate, usePath } from "./lib/router";
import type { Alert, Job, OneDriveStatus, UpdateInfo } from "./lib/types";
import { ConfirmDialog, IconButton, Menu, MenuItem, PageLoader } from "./components/ui";
import { useAction } from "./lib/hooks";
import { JobDialog } from "./components/jobs";
import { Reconnecting, UpdateOverlay, UpdatePill } from "./components/update";
import { RestartOverlay, restartNas } from "./components/restart";
import Login from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import FilesPage from "./pages/Files";
import NotificationsPage from "./pages/Notifications";
import OneDrivePage from "./pages/OneDrive";
import RaidPage from "./pages/Raid";
import VolumesPage from "./pages/Volumes";
import DisksPage from "./pages/Disks";
import SharesPage from "./pages/Shares";
import UsersPage from "./pages/Users";
import ServicesPage from "./pages/Services";
import SettingsPage from "./pages/Settings";
import ActivityPage from "./pages/Activity";
import DocumentationPage from "./pages/Documentation";
import ScheduledPage from "./pages/Scheduled";
import AntivirusPage from "./pages/Antivirus";
import BackupPage from "./pages/Backup";

type Me = { user: string; version: string; demo: boolean };

const NAV: { section: string; items: { to: string; label: string; icon: ComponentType<{ className?: string }>; page: ComponentType }[] }[] = [
  { section: "", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, page: DashboardPage }] },
  {
    section: "Storage",
    items: [
      { to: "/disks", label: "Disks", icon: HardDrive, page: DisksPage },
      { to: "/raid", label: "RAID", icon: Layers, page: RaidPage },
      { to: "/volumes", label: "Volumes", icon: Database, page: VolumesPage },
    ],
  },
  {
    section: "Files",
    items: [
      { to: "/backup", label: "Backup", icon: DatabaseBackup, page: BackupPage },
      { to: "/browser", label: "Browser", icon: FolderTree, page: FilesPage },
      { to: "/onedrive", label: "OneDrive", icon: Cloud, page: OneDrivePage },
    ],
  },
  {
    section: "Sharing",
    items: [
      { to: "/shares", label: "Shared Folders", icon: FolderOpen, page: SharesPage },
      { to: "/users", label: "Users & Groups", icon: UsersIcon, page: UsersPage },
    ],
  },
  {
    section: "System",
    items: [
      { to: "/activity", label: "Activity", icon: ActivityIcon, page: ActivityPage },
      { to: "/settings", label: "Settings", icon: SettingsIcon, page: SettingsPage },
      { to: "/services", label: "Services", icon: Server, page: ServicesPage },
      { to: "/antivirus", label: "Antivirus", icon: ShieldCheck, page: AntivirusPage },
      { to: "/scheduled", label: "Scheduled", icon: Clock, page: ScheduledPage },
      { to: "/notifications", label: "Notifications", icon: Mail, page: NotificationsPage },
      { to: "/documentation", label: "Documentation", icon: BookOpen, page: DocumentationPage },
    ],
  },
];

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me"), retry: false, staleTime: Infinity });
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(["me"], null));
  }, [qc]);
  if (me.isLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    );
  if (me.error && (me.error as { status?: number }).status !== 401)
    return <Reconnecting onBack={() => me.refetch()} />;
  if (!me.data) return <Login onLogin={() => qc.invalidateQueries()} />;
  return <Shell me={me.data} />;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8 drop-shadow-[0_4px_12px_rgba(99,102,241,0.35)]" />
      <div className="text-[17px] leading-none font-bold tracking-tight">
        Talon
        <span className="ml-1.5 align-middle text-[10px] font-semibold tracking-widest text-brand-500 uppercase dark:text-brand-400">NAS</span>
      </div>
    </div>
  );
}

function Shell({ me }: { me: Me }) {
  const path = usePath();
  // dates and times in the format chosen in Settings → General, before anything renders them
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings"), staleTime: 60000 });
  setFormats(settings.data?.date_format, settings.data?.time_format);
  const qc = useQueryClient();
  const [dark, toggleTheme] = useTheme();
  const [mobileNav, setMobileNav] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [power, setPower] = useState<"reboot" | "poweroff" | null>(null);
  const doPower = useAction((action: string) => (action === "reboot" ? restartNas() : api.post("/system/power", { action })), {
    success: (_r, a) => (a === "reboot" ? "" : "Shutting down…"),
    onSuccess: () => setPower(null),
  });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs"), refetchInterval: 3000 });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ alerts: Alert[] }>("/dashboard").then((d) => d.alerts),
    refetchInterval: 30000,
  });
  const update = useQuery({ queryKey: ["update"], queryFn: () => api.get<UpdateInfo>("/update"), refetchInterval: 15 * 60000 });
  const onedrive = useQuery({ queryKey: ["onedrive"], queryFn: () => api.get<OneDriveStatus>("/onedrive"), refetchInterval: 30000 });
  const running = (jobs.data ?? []).filter((j) => j.status === "running" || j.status === "queued");

  // refresh storage views when a job finishes
  const [prevRunning, setPrevRunning] = useState(0);
  useEffect(() => {
    if (running.length < prevRunning) ["volumes", "disks", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setPrevRunning(running.length);
  }, [running.length]); // eslint-disable-line

  useEffect(() => setMobileNav(false), [path]);
  useEffect(() => {
    if (path === "/storage") navigate("/volumes"); // old address
    if (path === "/support") navigate("/documentation" + location.search); // old address
  }, [path]);

  const all = NAV.flatMap((s) => s.items);
  // the OneDrive link is shown only while the OneDrive service is enabled
  const onedriveOn = !!onedrive.data?.enabled;
  const visible = (to: string) => to !== "/onedrive" || onedriveOn || path === "/onedrive";
  const current = all.find((i) => i.to === path) ?? (path === "/" ? all[0] : null);
  const Page = current?.page ?? (() => <NotFound />);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.setQueryData(["me"], null);
    navigate("/");
  };

  const notifications = (align: "left" | "right") => (
    <Menu
      align={align}
      trigger={
        <IconButton label="Notifications" className="relative">
          <Bell className="size-5" />
          {!!alerts.data?.length && (
            <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-zinc-50 dark:ring-zinc-950">
              {alerts.data.length}
            </span>
          )}
        </IconButton>
      }
    >
      <div className="w-72 px-2 py-1.5 text-xs font-semibold text-zinc-500">Notifications</div>
      {alerts.data?.length ? (
        alerts.data.map((a, i) => (
          <MenuItem key={i} onClick={() => navigate(a.link)}>
            <div>
              <div className={a.level === "critical" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>{a.title}</div>
              <div className="text-xs font-normal text-zinc-500">{a.detail}</div>
            </div>
          </MenuItem>
        ))
      ) : (
        <div className="px-2.5 pb-3 text-[13px] text-zinc-500">All clear — no issues detected.</div>
      )}
    </Menu>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <div className="hidden lg:block">{notifications("left")}</div>
        <IconButton label="Close menu" className="lg:hidden" onClick={() => setMobileNav(false)}>
          <X className="size-5" />
        </IconButton>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3 [scrollbar-width:none]">
        {NAV.map((s) => (
          <div key={s.section}>
            {s.section && <div className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">{s.section}</div>}
            <div className="space-y-0.5">
              {s.items.filter((i) => visible(i.to)).map((i) => {
                const active = i.to === path;
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-medium transition",
                      active
                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/70 dark:bg-white/[0.07] dark:text-white dark:ring-white/5"
                        : "text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100",
                    )}
                  >
                    <i.icon className={cx("size-[18px]", active ? "text-brand-600 dark:text-brand-400" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300")} />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {(me.demo || running.length > 0 || (update.data?.available && update.data.status.state !== "running")) && (
        <div className="space-y-2 px-3 pb-3">
          {me.demo && (
            <div className="rounded-full bg-amber-100 px-3 py-1.5 text-center text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Demo mode — simulated hardware
            </div>
          )}
          {update.data?.available && update.data.status.state !== "running" && (
            <UpdatePill version={update.data.latest!} onClick={() => navigate("/settings?tab=update")} />
          )}
          {running.length > 0 && (
            <Menu
              align="left"
              placement="top"
              trigger={
                <button className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20">
                  <Loader2 className="size-3.5 animate-spin" />
                  {running.length} task{running.length > 1 ? "s" : ""} running
                </button>
              }
            >
              {running.map((j) => (
                <MenuItem key={j.id} onClick={() => setOpenJob(j.id)} icon={<Loader2 className="animate-spin" />}>
                  {j.title}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
      )}
      <div className="border-t border-zinc-200/70 p-3 dark:border-white/5">
        <div className="flex items-center gap-1">
          <Menu
            align="left"
            placement="top"
            className="min-w-0 flex-1"
            trigger={
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-200/40 dark:hover:bg-white/[0.04]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-sm font-semibold text-white uppercase">
                  {me.user.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{me.user}</span>
                <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" />
              </button>
            }
          >
            <MenuItem icon={<LogOut />} onClick={logout}>
              Log out
            </MenuItem>
            <MenuItem icon={<RotateCcw />} onClick={() => setPower("reboot")}>
              Restart
            </MenuItem>
            <MenuItem icon={<Power />} danger onClick={() => setPower("poweroff")}>
              Shut down
            </MenuItem>
          </Menu>
          <IconButton label={dark ? "Light mode" : "Dark mode"} onClick={toggleTheme}>
            {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200/70 bg-zinc-100/60 backdrop-blur lg:block dark:border-white/5 dark:bg-zinc-900/40">
        {sidebar}
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-in bg-black/40" onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide bg-zinc-50 shadow-xl dark:bg-zinc-900">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200/70 bg-zinc-50/80 px-4 backdrop-blur-xl sm:px-6 lg:hidden dark:border-white/5 dark:bg-zinc-950/70">
          <IconButton label="Open menu" onClick={() => setMobileNav(true)}>
            <MenuIcon className="size-5" />
          </IconButton>
          <Logo />
          <div className="flex-1" />
          {notifications("right")}
        </header>
        <main className="mx-auto max-w-[1400px] px-4 pt-4 pb-6 sm:px-6 lg:px-8 lg:pt-3 lg:pb-8">
          <div key={path} className="animate-in">
            <Page key={`${settings.data?.date_format}-${settings.data?.time_format}`} />
          </div>
        </main>
      </div>
      <JobDialog jobId={openJob} onClose={() => setOpenJob(null)} />
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
      <UpdateOverlay />
      <RestartOverlay />
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-brand-600">
        Back to dashboard
      </Link>
    </div>
  );
}

export { PageLoader };
