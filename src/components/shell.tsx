"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, Building2, FileText, LayoutDashboard, Moon, Radar, Search, Settings, Sun, Workflow, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fr } from "@/i18n/fr";

const NAV = [
  { href: "/dashboard", label: fr.nav.dashboard, icon: LayoutDashboard },
  { href: "/tenders", label: fr.nav.tenders, icon: Search },
  { href: "/pipeline", label: fr.nav.pipeline, icon: Briefcase },
  { href: "/proposals", label: fr.nav.proposals, icon: FileText },
  { href: "/company", label: fr.nav.company, icon: Building2 },
  { href: "/sources", label: fr.nav.sources, icon: Workflow },
  { href: "/settings", label: fr.nav.settings, icon: Settings },
];

export function Sidebar({ orgName, open, onClose }: { orgName: string; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar transition-transform lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Radar className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">TenderPilot AI</p>
          <p className="truncate text-xs text-muted-foreground">{orgName}</p>
        </div>
        <button className="ml-auto lg:hidden" onClick={onClose} aria-label="Fermer le menu">
          <X className="size-4" />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      className="flex size-9 items-center justify-center rounded-md hover:bg-muted"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("theme", next ? "dark" : "light");
        } catch {}
        setDark(next);
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function AppFrame({ orgName, topbar, children }: { orgName: string; topbar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <Sidebar orgName={orgName} open={open} onClose={() => setOpen(false)} />
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="size-5" />
          </button>
          {topbar}
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
