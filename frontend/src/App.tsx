import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType } from "react";
import {
  Activity as ActivityIcon,
  Bell,
  Database,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Server,
  Settings as SettingsIcon,
  Sun,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { api, setUnauthorizedHandler } from "./lib/api";
import { cx } from "./lib/format";
import { useTheme } from "./lib/hooks";
import { Link, navigate, usePath } from "./lib/router";
import type { Alert, Job } from "./lib/types";
import { IconButton, Menu, MenuItem, PageLoader } from "./components/ui";
import { JobDialog } from "./components/jobs";
import Login from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import VolumesPage from "./pages/Volumes";
import DisksPage from "./pages/Disks";
import SharesPage from "./pages/Shares";
import UsersPage from "./pages/Users";
import ServicesPage from "./pages/Services";
import SettingsPage from "./pages/Settings";
import ActivityPage from "./pages/Activity";

type Me = { user: string; version: string; demo: boolean };

const NAV: { section: string; items: { to: string; label: string; icon: ComponentType<{ className?: string }>; page: ComponentType }[] }[] = [
  { section: "", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, page: DashboardPage }] },
  {
    section: "Storage",
    items: [
      { to: "/storage", label: "Volumes & RAID", icon: Database, page: VolumesPage },
      { to: "/disks", label: "Disks", icon: HardDrive, page: DisksPage },
    ],
  },
  {
    section: "Sharing",
    items: [
      { to: "/shares", label: "Shared folders", icon: FolderOpen, page: SharesPage },
      { to: "/users", label: "Users & groups", icon: UsersIcon, page: UsersPage },
    ],
  },
  {
    section: "System",
    items: [
      { to: "/services", label: "Services", icon: Server, page: ServicesPage },
      { to: "/settings", label: "Settings", icon: SettingsIcon, page: SettingsPage },
      { to: "/activity", label: "Activity", icon: ActivityIcon, page: ActivityPage },
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
  if (!me.data) return <Login onLogin={() => qc.invalidateQueries()} />;
  return <Shell me={me.data} />;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8 drop-shadow-sm" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Talon</div>
      </div>
    </div>
  );
}

function Shell({ me }: { me: Me }) {
  const path = usePath();
  const qc = useQueryClient();
  const [dark, toggleTheme] = useTheme();
  const [mobileNav, setMobileNav] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const host = useQuery({ queryKey: ["system"], queryFn: () => api.get<{ hostname: string; version: string }>("/system"), staleTime: 60000 });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<Job[]>("/jobs"), refetchInterval: 3000 });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ alerts: Alert[] }>("/dashboard").then((d) => d.alerts),
    refetchInterval: 30000,
  });
  const running = (jobs.data ?? []).filter((j) => j.status === "running" || j.status === "queued");

  // refresh storage views when a job finishes
  const [prevRunning, setPrevRunning] = useState(0);
  useEffect(() => {
    if (running.length < prevRunning) ["volumes", "disks", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setPrevRunning(running.length);
  }, [running.length]); // eslint-disable-line

  useEffect(() => setMobileNav(false), [path]);

  const all = NAV.flatMap((s) => s.items);
  const current = all.find((i) => i.to === path) ?? (path === "/" ? all[0] : null);
  const Page = current?.page ?? (() => <NotFound />);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.setQueryData(["me"], null);
    navigate("/");
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <IconButton label="Close menu" className="lg:hidden" onClick={() => setMobileNav(false)}>
          <X className="size-5" />
        </IconButton>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {NAV.map((s) => (
          <div key={s.section}>
            {s.section && <div className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">{s.section}</div>}
            <div className="space-y-0.5">
              {s.items.map((i) => {
                const active = i.to === path;
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
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
      <div className="border-t border-zinc-200/70 p-3 dark:border-white/5">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-sm font-semibold text-white uppercase">
            {me.user.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{me.user}</div>
            <div className="truncate text-xs text-zinc-500">{host.data?.hostname ?? "…"}</div>
          </div>
          <IconButton label={dark ? "Light mode" : "Dark mode"} onClick={toggleTheme}>
            {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </IconButton>
          <IconButton label="Sign out" onClick={logout}>
            <LogOut className="size-4.5" />
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
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200/70 bg-zinc-50/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-white/5 dark:bg-zinc-950/70">
          <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileNav(true)}>
            <MenuIcon className="size-5" />
          </IconButton>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex-1" />
          {me.demo && (
            <span className="hidden rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 sm:inline dark:bg-amber-500/15 dark:text-amber-300">
              Demo mode — simulated hardware
            </span>
          )}
          {running.length > 0 && (
            <Menu
              trigger={
                <button className="flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20">
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
          <Menu
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
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div key={path} className="animate-in">
            <Page />
          </div>
        </main>
      </div>
      <JobDialog jobId={openJob} onClose={() => setOpenJob(null)} />
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
