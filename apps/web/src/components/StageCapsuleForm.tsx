"use client";

/**
 * Stage-capsule form — client component that POSTs to /api/arena/stage-capsule
 * and refreshes the page on success.
 *
 * Tiny by design: bet input + Stage button + status line. No external state.
 * Honors the parent's `disabled` prop so the page can show why staging is
 * blocked (e.g. opportunity expired, agent has no compatible strategy).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  agentId: number;
  opportunityId: number;
  defaultBetUsd: number;
  side?: string;
  disabled?: boolean;
};

export function StageCapsuleForm({ agentId, opportunityId, defaultBetUsd, side, disabled }: Props) {
  const router = useRouter();
  const [betUsd, setBetUsd] = useState<string>(defaultBetUsd.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    const bet = Number(betUsd);
    if (!Number.isFinite(bet) || bet <= 0) {
      setStatus({ kind: "err", msg: "Bet must be a positive number." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/arena/stage-capsule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, opportunityId, betUsd: bet, side }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setStatus({ kind: "err", msg: json.error ? JSON.stringify(json.error).slice(0, 140) : `HTTP ${res.status}` });
        setBusy(false);
        return;
      }
      setStatus({ kind: "ok", msg: `staged ${json.capsule?.id?.slice(0, 8)} · paused` });
      setBusy(false);
      router.refresh();
    } catch (err) {
      setStatus({ kind: "err", msg: (err as Error).message.slice(0, 140) });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-zinc-500">Bet</span>
      <span className="text-zinc-500">$</span>
      <input
        type="number"
        min={0.5}
        step={0.5}
        value={betUsd}
        onChange={(e) => setBetUsd(e.target.value)}
        disabled={disabled || busy}
        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-20 text-zinc-200 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || busy}
        className="px-3 py-1 rounded bg-accent-blue text-zinc-100 hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "staging…" : "Stage capsule"}
      </button>
      {status.kind === "ok" && <span className="text-accent-green">✓ {status.msg}</span>}
      {status.kind === "err" && <span className="text-accent-red">⚠ {status.msg}</span>}
      {disabled && status.kind === "idle" && (
        <span className="text-zinc-500 text-[10px]">staging disabled</span>
      )}
    </form>
  );
}
