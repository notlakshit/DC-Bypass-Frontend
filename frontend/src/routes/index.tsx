import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatedBackground } from "@/components/AnimatedBackground";

export const Route = createFileRoute("/")({
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
  | { step: "done"; success: boolean; message?: string; userid?: string; count?: number }
  | { step: "error"; message: string; code?: string };

function toFullUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[A-Za-z0-9_-]{4,}$/.test(v)) return `https://beta.doublecounter.gg/v/${v}`;
  const code = v.includes("/") ? (v.split("/").filter(Boolean).pop() ?? "") : v;
  if (/^[A-Za-z0-9_-]{4,}$/.test(code)) return `https://beta.doublecounter.gg/v/${code}`;
  return null;
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
          setStatus({ kind: "error", message: "Something went wrong." });
        }
      } else if (data.step === "error") {
        doneRef.current = true;
        closeStream();
        setStatus({
          kind: "error",
          message:
            data.code === "dead_link"
              ? "Link is dead or expired. Generate a fresh link."
              : "Something went wrong.",
        });
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
          Made by <span className="font-medium text-foreground">Velorsi</span>
        </div>
      </section>
    </main>
  );
}
