import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatedBackground } from "@/components/AnimatedBackground";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DoubleCounter Bypass — Paste a link, get a result" },
      {
        name: "description",
        content: "Double Counter Bypass",
      },
      { property: "og:title", content: "DoubleCounter Bypass" },
      { property: "og:description", content: "Double Counter Bypass" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "https://dc-bypass-production-3408.up.railway.app";

type Status =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; message: string; userid?: string };

type SolveEvent =
  | { step: "queued" | "loading" | "solving" | "verifying"; message: string }
  | { step: "done"; success: boolean; message?: string; userid?: string; count?: number; code?: string }
  | { step: "error"; message: string; code?: string };

function toFullUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[A-Za-z0-9_-]{4,}$/.test(v)) return `https://beta.doublecounter.gg/v/${v}`;
  const code = v.includes("/") ? v.split("/").filter(Boolean).pop() ?? "" : v;
  if (/^[A-Za-z0-9_-]{4,}$/.test(code)) return `https://beta.doublecounter.gg/v/${code}`;
  return null;
}

function errorForCode(code?: string): string {
  switch (code) {
    case "dead_link":
      return "Link is dead or expired. Generate a fresh link.";
    case "timed_out":
      return "Timed out, Please Try Again";
    case "verification_failed":
      return "Account Blacklisted";
    default:
      return "Something went wrong.";
  }
}

function Index() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [count, setCount] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);

  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/stats`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function closeStream() {
    esRef.current?.close();
    esRef.current = null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const full = toFullUrl(value);
    if (!full) {
      setStatus({ kind: "error", message: "Enter a valid DoubleCounter URL or code." });
      return;
    }

    closeStream();
    doneRef.current = false;
    setStatus({ kind: "running", label: "Verifying..." });

    const es = new EventSource(`${API_BASE}/api/solve?link=${encodeURIComponent(full)}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      if (doneRef.current) return;
      let data: SolveEvent;
      try {
        data = JSON.parse(ev.data) as SolveEvent;
      } catch {
        return;
      }

      if (data.step === "done") {
        doneRef.current = true;
        closeStream();
        if (data.success) {
          if (typeof data.count === "number") setCount(data.count);
          setStatus({ kind: "ok", message: "VERIFIED" });
        } else {
          setStatus({ kind: "error", message: errorForCode(data.code) });
        }
      } else if (data.step === "error") {
        doneRef.current = true;
        closeStream();
        setStatus({ kind: "error", message: errorForCode(data.code) });
      }
    };

    es.onerror = () => {
      if (doneRef.current) return;
      closeStream();
      setStatus({ kind: "error", message: "Something went wrong." });
    };
  }

  const running = status.kind === "running";

  return (
    <main className="relative flex min-h-screen items-center justify-center px-5 py-16">
      <AnimatedBackground />

      <section className="glass-card w-full max-w-[33rem] rounded-3xl px-8 py-11 sm:px-12 sm:py-14">
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-center">
          <p className="text-sm font-medium text-amber-200">
            Keep this running — donations welcome
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText("LapfHPxupB59s5fZntWvEtM5jauPhLR8wo"); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90 transition-colors hover:bg-amber-500/15"
            >
              <svg viewBox="0 0 32 32" className="h-5 w-5 flex-shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="16" fill="#2c2c4a" />
                <path d="M16 4l9 6.5v11L16 28l-9-6.5v-11L16 4z" fill="#6979f8" opacity="0.9" />
                <path d="M22.5 15.5c.3-1.9-1.1-3-3.2-3.6l.7-2.7-1.6-.4-.6 2.6a14 14 0 0 0-1.3-.3l.6-2.5-1.6-.4-.7 2.7c-.4-.1-.8-.2-1.2-.3l-2.2-.6-.4 1.7 1.6.4.7 2.7.5 1.9-1 3.7-.3 1.1 2.2.6 1.1 2.7 1.6.4.7-2.6c.5.1 1 .2 1.4.4l-.7 2.6 1.6.4.7-2.7c2.7.5 4.7.3 5.6-2.1.7-2-0.1-3.1-1.5-3.8 1.1-.3 1.9-1 2.1-2.3z" fill="#fff" />
              </svg>
              <span className="flex-1 break-all text-left font-mono">LTC: LapfHPxupB59s5fZntWvEtM5jauPhLR8wo</span>
              <span className="text-amber-200/60">copy</span>
            </button>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText("bc1q9dphvqe2s6v84aaqv5xvhzd39yjew53uru7gwf"); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90 transition-colors hover:bg-amber-500/15"
            >
              <svg viewBox="0 0 32 32" className="h-5 w-5 flex-shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="16" fill="#f7931a" />
                <path d="M24.5 19.6c-.4 1.5-3 2.2-5.2 2.6l-1 3.6-2.2-.6 1-3.5c.6-.1 1.2-.3 1.7-.5l-1 3.5-2.2-.6 1-3.6c.5-.1.9-.3 1.4-.4l-1.6-5.6c.6-.2 1.3-.4 1.9-.5l1.6 5.6c.6-.2 1.2-.3 1.8-.5l1.6 5.7c.6-.2 1.3-.4 1.9-.5l.7 2.4z" fill="#fff" />
              </svg>
              <span className="flex-1 break-all text-left font-mono">BTC: bc1q9dphvqe2s6v84aaqv5xvhzd39yjew53uru7gwf</span>
              <span className="text-amber-200/60">copy</span>
            </button>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText("0xD9Effa4ea4bFC33caD292717aE3A45d13d81eAA3"); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90 transition-colors hover:bg-amber-500/15"
            >
              <svg viewBox="0 0 32 32" className="h-5 w-5 flex-shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="16" fill="#8247e5" />
                <path d="M21.5 12.8l-3-1.7c-.3-.2-.7-.2-1 0L13 13.2c-.3.2-.5.5-.5.9v3.4c0 .4.2.7.5.9l3 1.7c.3.2.7.2 1 0l2-1.1 1-1.7c.2-.3.5-.5.9-.5h.1c.4 0 .7.2.9.5.2.3.2.7 0 1l-1.5 2.5c-.2.3-.5.5-.8.6l-3.5 2c-.3.2-.7.2-1 0l-5-2.8c-.3-.2-.5-.5-.5-.9v-5.6c0-.4.2-.7.5-.9l5-2.8c.3-.2.7-.2 1 0z" fill="#fff" />
              </svg>
              <span className="flex-1 break-all text-left font-mono">POLY: 0xD9Effa4ea4bFC33caD292717aE3A45d13d81eAA3</span>
              <span className="text-amber-200/60">copy</span>
            </button>
          </div>
        </div>
        <h1 className="text-center font-display text-4xl leading-tight tracking-tight text-foreground sm:text-5xl">
          DoubleCounter Bypass
        </h1>
        <p className="mt-3 text-center text-base text-muted-foreground">
          bypass the doublecounter discord bot
        </p>

        <form onSubmit={handleSubmit} className="mt-10">
          <label
            htmlFor="dc-input"
            className="block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            DoubleCounter URL or code
          </label>

          <input
            id="dc-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setStatus({ kind: "idle" });
            }}
            placeholder="https://beta.doublecounter.gg/v/********"
            autoComplete="off"
            spellCheck={false}
            disabled={running}
            className="mt-3 w-full rounded-2xl border border-border bg-input px-5 py-4 text-base text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-ring focus:bg-input/80 disabled:opacity-60"
          />

          <button
            type="submit"
            disabled={running}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-display text-base text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {running && (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {running ? "Working..." : "Submit"}
          </button>

          {status.kind !== "idle" && (
            <div
              role="status"
              className={`mt-4 text-center text-sm ${
                status.kind === "error"
                  ? "text-destructive"
                  : status.kind === "ok"
                    ? "text-accent-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {status.kind === "running" && (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {status.label}
                </span>
              )}
              {status.kind === "error" && status.message}
              {status.kind === "ok" && status.message}
            </div>
          )}
        </form>

        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Bypassed Double Counter
          </p>
          <div className="mt-3 flex h-24 w-full max-w-[12rem] items-center justify-center rounded-2xl border border-border bg-card/70 shadow-inner">
            <span className="counter-glow font-display text-6xl tracking-tight text-foreground sm:text-7xl">
              {count ?? "—"}
            </span>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-5 text-center text-sm text-muted-foreground">
          Made by <a href="https://discord.com/users/1464228835435479284" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground transition-opacity hover:opacity-70">Velorsi</a>
        </div>
      </section>
    </main>
  );
}
