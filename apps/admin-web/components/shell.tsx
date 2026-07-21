"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, Home, Import, Settings, Users } from "lucide-react";
import { cn } from "@/components/ui";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/videos", label: "Videos", icon: Film },
  { href: "/children", label: "Children", icon: Users },
  { href: "/imports", label: "Imports", icon: Import },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-panel px-3 py-4 md:block">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid size-8 place-items-center rounded-ui bg-accent text-sm font-semibold text-panel">H</div>
          <div>
            <div className="text-lg font-semibold tracking-normal">HappiE</div>
            <div className="text-xs text-muted">Family library admin</div>
          </div>
        </div>
        <nav className="grid gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn("flex h-9 items-center gap-2 rounded-ui px-2 text-sm font-medium text-muted transition hover:bg-ink/[0.035] hover:text-ink", active && "bg-accent/10 text-ink ring-1 ring-accent/20")}>
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <header className="sticky top-0 z-20 border-b border-border bg-panel md:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold tracking-normal">
            <span className="grid size-8 place-items-center rounded-ui bg-accent text-sm text-panel">H</span>
            HappiE
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-ui px-3 text-sm text-muted hover:bg-ink/5 hover:text-ink",
                  active && "bg-accent/10 text-ink ring-1 ring-accent/20"
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="md:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-5 md:px-8 md:py-6">{children}</div>
      </main>
    </div>
  );
}
