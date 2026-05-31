"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["new", "triaging", "developing", "shipped", "parked"] as const;
type Status = (typeof STATUSES)[number];

export function ArticleActions({
  articleId,
  status,
  isCurrentFocus,
  hasGapReport,
  llmAvailable,
}: {
  articleId: number;
  status: string;
  isCurrentFocus: boolean;
  hasGapReport: boolean;
  llmAvailable: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (body: unknown) => {
    const res = await fetch(`/api/articles/${articleId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Failed");
      return;
    }
    startTransition(() => router.refresh());
  };

  const generateReport = async () => {
    setGenBusy(true);
    setError(null);
    const res = await fetch(`/api/articles/${articleId}/gap-report`, { method: "POST" });
    setGenBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "LLM call failed");
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex items-center gap-2 text-xs shrink-0">
      {error && <span className="text-rose-400">{error}</span>}
      <select
        value={status as Status}
        disabled={busy}
        onChange={(e) => post({ status: e.target.value })}
        className="bg-ink-900 border border-ink-700 rounded px-2 py-1"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => post({ is_current_focus: !isCurrentFocus })}
        className={`px-2 py-1 rounded border ${
          isCurrentFocus
            ? "bg-accent-blue/30 border-accent-blue/60 text-accent-blue"
            : "bg-ink-900 border-ink-700 hover:border-zinc-500"
        }`}
      >
        {isCurrentFocus ? "★ focus" : "set focus"}
      </button>
      <button
        type="button"
        disabled={genBusy || !llmAvailable}
        onClick={generateReport}
        className="px-2 py-1 rounded border bg-ink-900 border-ink-700 hover:border-zinc-500 disabled:opacity-50"
        title={llmAvailable ? "Call Claude haiku 4.5" : "Anthropic auth unavailable"}
      >
        {genBusy ? "Generating…" : hasGapReport ? "Regenerate gap report" : "Generate gap report"}
      </button>
    </div>
  );
}
