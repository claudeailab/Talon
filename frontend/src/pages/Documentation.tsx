import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { GUIDE, blockText, plain, type Block, type Topic } from "../lib/guide";
import { cx } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { Callout, Card, Input, PageHeader, Select } from "../components/ui";

const GROUPS = ["Basics", "Storage", "Sharing", "Cloud and alerts", "System"] as const;

function topicFromUrl(): string {
  const id = new URLSearchParams(location.search).get("topic");
  return GUIDE.some((t) => t.id === id) ? id! : GUIDE[0].id;
}

export default function DocumentationPage() {
  const [topicId, setTopicId] = useState(topicFromUrl);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const topic = GUIDE.find((t) => t.id === topicId)!;

  // back / forward between topics
  useEffect(() => {
    const sync = () => setTopicId(topicFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // after opening a search result, scroll to its section
  useEffect(() => {
    if (!section) return;
    document.getElementById(`s-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSection(null);
  }, [section, topicId]);

  const open = (id: string, sec?: string) => {
    if (id !== topicId) history.pushState(null, "", `/documentation?topic=${id}`);
    setTopicId(id);
    setQuery("");
    if (sec) setSection(sec);
    else window.scrollTo({ top: 0 });
  };

  // "/" focuses the search box
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => (terms.length ? search(terms) : []), [terms]);
  const index = GUIDE.indexOf(topic);

  return (
    <>
      <PageHeader title="Documentation" description="How Talon works and how to set up each feature." />

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && results[0]) open(results[0].topic.id, results[0].section);
          }}
          placeholder="Search the guide"
          aria-label="Search the guide"
          className="h-11 pr-10 pl-10 text-[15px]"
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* topics */}
        <nav className="hidden lg:block">
          <Card className="sticky top-6 p-3">
            {GROUPS.map((g) => (
              <div key={g} className="mb-3 last:mb-0">
                <div className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">{g}</div>
                {GUIDE.filter((t) => t.group === g).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    className={cx(
                      "flex w-full items-center rounded-lg px-3 py-1.5 text-left text-[13px] font-medium whitespace-nowrap transition",
                      t.id === topicId && !terms.length
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100",
                    )}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            ))}
          </Card>
        </nav>
        <div className="lg:hidden">
          <Select value={topicId} onChange={(e) => open(e.target.value)} aria-label="Topic">
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {GUIDE.filter((t) => t.group === g).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        {/* search results or the topic */}
        {terms.length ? (
          <Card className="min-w-0 p-2">
            <div className="px-3 pt-2 pb-1 text-[13px] text-zinc-500">
              {results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : `No results for "${query.trim()}"`}
            </div>
            <ul>
              {results.map((r) => (
                <li key={r.topic.id + r.section}>
                  <button
                    onClick={() => open(r.topic.id, r.section)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        <span className="text-zinc-500">{r.topic.title}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-zinc-400" />
                        <Highlight text={r.title} terms={terms} />
                      </div>
                      <div className="truncate text-[13px] text-zinc-500">
                        <Highlight text={r.snippet} terms={terms} />
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-zinc-300" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="min-w-0 p-5 sm:p-7">
            <Article topic={topic} onTopic={open} />
            <div className="mt-8 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-5 dark:border-white/5">
              {index > 0 ? (
                <button onClick={() => open(GUIDE[index - 1].id)} className="flex min-w-0 items-center gap-2 text-left text-[13px] text-zinc-500 hover:text-brand-600">
                  <ArrowLeft className="size-4 shrink-0" />
                  <span className="truncate">{GUIDE[index - 1].title}</span>
                </button>
              ) : (
                <span />
              )}
              {index < GUIDE.length - 1 && (
                <button onClick={() => open(GUIDE[index + 1].id)} className="flex min-w-0 items-center justify-end gap-2 text-right text-[13px] text-zinc-500 hover:text-brand-600">
                  <span className="truncate">{GUIDE[index + 1].title}</span>
                  <ArrowRight className="size-4 shrink-0" />
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Article({ topic, onTopic }: { topic: Topic; onTopic: (id: string) => void }) {
  return (
    <article>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{topic.title}</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{topic.summary}</p>
        </div>
        {topic.page && (
          <Link
            to={topic.page.to}
            className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-xl bg-brand-50 px-3.5 text-[13px] font-medium whitespace-nowrap text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20"
          >
            {topic.page.label} <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>

      {topic.before && (
        <Callout tone="warning" title="Before you start" className="mt-5">
          <ul className="list-disc space-y-0.5 pl-4">
            {topic.before.map((b, i) => (
              <li key={i}>
                <Inline text={b} onTopic={onTopic} />
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {topic.sections.map((s) => (
        <section key={s.id} id={`s-${s.id}`} className="mt-7 scroll-mt-6">
          <h3 className="mb-3 text-base font-semibold">{s.title}</h3>
          <div className="space-y-3.5 text-sm leading-relaxed text-pretty text-zinc-700 dark:text-zinc-300">
            {s.blocks.map((b, i) => (
              <BlockView key={i} b={b} onTopic={onTopic} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function BlockView({ b, onTopic }: { b: Block; onTopic: (id: string) => void }) {
  if ("p" in b) return <p><Inline text={b.p} onTopic={onTopic} /></p>;
  if ("steps" in b)
    return (
      <ol className="space-y-2.5">
        {b.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{i + 1}</span>
            <span className="min-w-0 pt-0.5"><Inline text={s} onTopic={onTopic} /></span>
          </li>
        ))}
      </ol>
    );
  if ("list" in b)
    return (
      <ul className="space-y-1.5">
        {b.list.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <span className="min-w-0"><Inline text={s} onTopic={onTopic} /></span>
          </li>
        ))}
      </ul>
    );
  if ("img" in b)
    return (
      <a href={`/guide/${b.img}.webp`} target="_blank" rel="noreferrer" className="group relative block" title="Open full size">
        <img
          src={`/guide/${b.img}.webp`}
          alt={b.alt}
          loading="lazy"
          width={1280}
          height={800}
          className="h-auto w-full rounded-xl ring-1 ring-zinc-200 dark:ring-white/10"
        />
        <span className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-lg bg-white/90 text-zinc-600 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-zinc-900/90 dark:text-zinc-300">
          <ExternalLink className="size-3.5" />
        </span>
      </a>
    );
  if ("tip" in b) return <Callout tone="info"><Inline text={b.tip} onTopic={onTopic} /></Callout>;
  return <Callout tone="warning"><Inline text={b.warn} onTopic={onTopic} /></Callout>;
}

/** **bold**, `code` and [text](/path); links to other topics open inside the guide. */
function Inline({ text, onTopic }: { text: string; onTopic: (id: string) => void }) {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[4] !== undefined) {
      out.push(<code key={m.index} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[12.5px] whitespace-nowrap text-zinc-800 dark:bg-white/10 dark:text-zinc-200">{m[4]}</code>);
    } else if (m[1] !== undefined) {
      out.push(<b key={m.index} className="font-semibold text-zinc-900 dark:text-zinc-100">{m[1]}</b>);
    } else {
      const href = m[3];
      const topic = href.match(/^\/documentation\?topic=([\w-]+)/)?.[1];
      const cls = "font-medium text-brand-600 hover:underline dark:text-brand-400";
      out.push(
        topic ? (
          <a key={m.index} href={href} className={cls} onClick={(e) => { e.preventDefault(); onTopic(topic); }}>{m[2]}</a>
        ) : (
          <a key={m.index} href={href} className={cls} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(href); }}>{m[2]}</a>
        ),
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-amber-100 text-inherit dark:bg-amber-500/25">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface Result {
  topic: Topic;
  section: string;
  title: string;
  snippet: string;
  score: number;
}

/** Sections that contain every search word (in their text, title or topic). */
function search(terms: string[]): Result[] {
  const out: Result[] = [];
  for (const topic of GUIDE) {
    const head = `${topic.title} ${topic.summary}`.toLowerCase();
    for (const s of topic.sections) {
      const body = s.blocks.map(blockText).join(" ");
      const hay = `${head} ${s.title} ${body}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      const title = s.title.toLowerCase();
      const score =
        terms.filter((t) => title.includes(t)).length * 3 +
        terms.filter((t) => topic.title.toLowerCase().includes(t)).length * 2 +
        terms.filter((t) => body.toLowerCase().includes(t)).length;
      out.push({ topic, section: s.id, title: s.title, snippet: snippet(body || plain(topic.summary), terms), score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 30);
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  if (!isFinite(at) || at < 40) return text;
  const start = text.lastIndexOf(" ", at - 30);
  return "…" + text.slice(start + 1);
}
