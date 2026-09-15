import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "360 Marketing",
  description:
    "Every ad channel and every sale in one place, with the analysis that says where the next dollar should go.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/channels", label: "Channels" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/sales", label: "Sales" },
  { href: "/recommendations", label: "Actions" },
  { href: "/creative", label: "Creative lab" },
  { href: "/analyst", label: "Ask" },
  { href: "/connections", label: "Connections" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-[1180px] flex-col px-4 py-6 sm:px-6">
          <header className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[17px] font-semibold tracking-tight">360 Marketing</span>
              <span className="text-[12px] text-[var(--text-muted)]">spend · sales · signal</span>
            </Link>
            <nav className="-mx-1 flex flex-1 flex-wrap items-center gap-x-1 gap-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="mt-10 border-t pt-4 text-[12px] text-[var(--text-muted)] hairline">
            Attributed revenue comes from matched store orders. Platform-reported revenue is each
            network marking its own homework — the two are never merged.
          </footer>
        </div>
      </body>
    </html>
  );
}
