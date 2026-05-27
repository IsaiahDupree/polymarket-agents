"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Drop-in client component that calls router.refresh() on an interval. Has
 * a small top-right pause toggle so the operator can freeze the view while
 * inspecting something. router.refresh() re-runs the server components
 * without scrolling or losing state — much smoother than meta-refresh.
 */
export function AutoRefresh({ intervalMs = 30_000, label = "auto-refresh" }: { intervalMs?: number; label?: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [lastTick, setLastTick] = useState<Date | null>(null);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      router.refresh();
      setLastTick(new Date());
    }, intervalMs);
    return () => clearInterval(id);
  }, [paused, intervalMs, router]);

  const seconds = Math.round(intervalMs / 1000);
  return (
    <div className="fixed top-20 right-6 z-10 flex items-center gap-2 text-[10px] bg-ink-900 border border-ink-800 rounded px-2 py-1 text-zinc-400">
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className={`px-1 ${paused ? "text-accent-amber" : "text-accent-green"}`}
        title={paused ? "auto-refresh paused — click to resume" : "auto-refresh active — click to pause"}
      >
        {paused ? "▶" : "⏸"}
      </button>
      <span>{paused ? "paused" : `${label} ${seconds}s`}</span>
      {lastTick && !paused && (
        // suppressHydrationWarning: server renders empty (no lastTick), client
        // fills in after first interval tick. toLocaleTimeString is locale-
        // dependent so SSR vs CSR would mismatch otherwise.
        <span className="text-zinc-600" suppressHydrationWarning>· last {lastTick.toLocaleTimeString()}</span>
      )}
    </div>
  );
}
