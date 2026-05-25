import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polymarket Agents",
  description: "Local control plane for AI-agent Polymarket trading strategies and research",
};

const nav = [
  { href: "/", label: "Overview" },
  { href: "/agents", label: "Agents" },
  { href: "/strategies", label: "Strategies" },
  { href: "/trades", label: "Trades" },
  { href: "/markets", label: "Markets" },
  { href: "/live", label: "Live" },
  { href: "/arb", label: "Arb" },
  { href: "/onchain", label: "On-chain" },
  { href: "/tracked", label: "Tracked" },
  { href: "/research", label: "Research" },
  { href: "/evolution", label: "Evolution" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-ink-950 text-zinc-100">
      <body className="min-h-screen font-mono text-sm">
        <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-6">
            <Link href="/" className="text-base font-semibold tracking-tight">
              poly<span className="text-accent-green">agents</span>
            </Link>
            <nav className="flex gap-4 text-zinc-400">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-zinc-100 transition-colors">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto text-xs text-zinc-500">
              signer: <span className="text-zinc-300">{process.env.POLYMARKET_RELAYER_API_KEY_ADDRESS?.slice(0, 10)}…{process.env.POLYMARKET_RELAYER_API_KEY_ADDRESS?.slice(-4)}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
