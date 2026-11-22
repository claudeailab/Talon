import { useEffect, useState } from "react";
import { ArrowRight, Lock, User } from "lucide-react";
import { api } from "../lib/api";
import { Button, Callout } from "../components/ui";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // a failed Microsoft sign-in comes back as ?login_error=...
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get("login_error"));
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<{ local: boolean; microsoft: boolean }>({ local: true, microsoft: false });
  useEffect(() => {
    if (location.search.includes("login_error")) history.replaceState(null, "", location.pathname);
    fetch("/api/auth/methods").then((r) => (r.ok ? r.json() : null)).then((m) => m && setMethods(m), () => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { username, password });
      // make sure the browser kept the session cookie before leaving this page
      const ok = await fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => r.ok, () => false);
      if (!ok) {
        setError("Your browser did not keep the sign-in. Clear this site's cookies and try again.");
        setBusy(false);
        return;
      }
      onLogin();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-4">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-600/40 via-violet-600/30 to-fuchsia-500/20 blur-3xl" />
        <div className="absolute right-[-10%] bottom-[-20%] h-[420px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
      </div>

      <div className="relative w-full max-w-[400px] animate-pop">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-5 size-16 drop-shadow-[0_10px_32px_rgba(129,140,248,0.55)]" />
          <h1 className="text-2xl font-semibold tracking-tight text-white">Welcome to Talon</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Sign in with an administrator account</p>
        </div>
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl">
          {error && <Callout tone="danger">{error}</Callout>}
          {methods.local && (
          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                autoFocus
                autoComplete="username"
                placeholder="User name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/[0.06] py-3 pr-3.5 pl-10 text-sm text-white ring-1 ring-white/10 transition ring-inset placeholder:text-zinc-500 focus:ring-2 focus:ring-brand-400 focus:outline-none"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/[0.06] py-3 pr-3.5 pl-10 text-sm text-white ring-1 ring-white/10 transition ring-inset placeholder:text-zinc-500 focus:ring-2 focus:ring-brand-400 focus:outline-none"
              />
            </div>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
              Sign in {!busy && <ArrowRight className="size-4" />}
            </Button>
          </form>
          )}
          {methods.local && methods.microsoft && (
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="h-px flex-1 bg-white/10" />
              or
              <span className="h-px flex-1 bg-white/10" />
            </div>
          )}
          {methods.microsoft && (
            <a
              href="/api/auth/microsoft"
              className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-white text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              <MicrosoftLogo />
              Sign in with Microsoft
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** The four-square Microsoft logo. */
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-[18px]" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
