import { LogOut, Search } from "lucide-react";
import { AppFrame, ThemeToggle } from "@/components/shell";
import { requireContext } from "@/server/auth/context";
import { ROLE_LABELS } from "@/server/auth/rbac";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <AppFrame
      orgName={ctx.orgName}
      topbar={
        <>
          <form action="/tenders" className="relative flex-1 md:max-w-md" role="search">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              placeholder="Rechercher un appel d'offres, un acheteur…"
              className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm"
              aria-label="Recherche globale"
            />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{ctx.name}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[ctx.role]}</p>
            </div>
            <form action={logoutAction}>
              <button className="flex size-9 items-center justify-center rounded-md hover:bg-muted" aria-label="Se déconnecter" title="Se déconnecter">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </>
      }
    >
      {children}
    </AppFrame>
  );
}
