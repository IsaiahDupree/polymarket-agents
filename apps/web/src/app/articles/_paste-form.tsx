"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ArticlePasteForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("X/Twitter (pasted)");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!title.trim() || body.trim().length < 20) {
      setError("Need both a title and a body (≥20 chars).");
      return;
    }
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        source: source.trim() || "X/Twitter (pasted)",
        url: url.trim() || undefined,
        body_md: body,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Failed to save article.");
      return;
    }
    const { id } = (await res.json()) as { id: number };
    startTransition(() => {
      router.push(`/articles/${id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm"
          placeholder="Title (e.g. The Exact Math That Pulled $40M)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm"
          placeholder="Source (e.g. @0x_Discover on X)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </div>
      <input
        className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm"
        placeholder="URL (optional)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <textarea
        className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono"
        placeholder="Paste the thread body…"
        rows={6}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="px-3 py-1 text-xs bg-accent-blue/20 hover:bg-accent-blue/30 border border-accent-blue/40 rounded disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save article"}
        </button>
      </div>
    </div>
  );
}
