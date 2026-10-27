import Link from "next/link";
import { DeadlineBadge, ScorePill, StatusBadge } from "@/components/badges";
import { BarList, SimpleBarChart } from "@/components/charts";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatEur } from "@/lib/utils";
import { requireContext } from "@/server/auth/context";
import { getDashboard } from "@/server/dashboard";

export const metadata = { title: "Tableau de bord" };

function Kpi({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:bg-muted/40">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const d = await getDashboard(ctx.orgId);
  const k = d.kpis;
  const n = (x: number) => x.toLocaleString("fr-FR");

  return (
    <>
      <PageHeader title={`Bonjour ${ctx.name.split(" ")[0]}`} description="Vue d'ensemble de la veille et des candidatures." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Nouveaux (7 j)" value={n(k.newCount)} href="/tenders?sort=published" />
        <Kpi label="Prioritaires" value={n(k.priority)} hint="pré-score ≥ 80" href="/tenders?minScore=80&sort=score" />
        <Kpi label="Qualifiés / GO" value={n(k.qualified)} href="/pipeline" />
        <Kpi label="En préparation" value={n(k.preparing)} href="/pipeline" />
        <Kpi label="Montant déposé" value={formatEur(k.submittedValue)} hint="estimations des marchés déposés" />
        <Kpi label="Gagnés / perdus" value={`${k.won} / ${k.lost}`} />
        <Kpi label="Conversion" value={k.conversion === null ? "—" : `${k.conversion} %`} hint="gagnés / décidés" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Meilleures opportunités ouvertes</CardTitle></CardHeader>
          <CardContent>
            {d.top.length === 0 ? (
              <EmptyState title="Aucune opportunité">Configurez votre <Link className="text-primary underline" href="/company">profil</Link> puis lancez une <Link className="text-primary underline" href="/sources">synchronisation</Link>.</EmptyState>
            ) : (
              <ul className="divide-y">
                {d.top.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <ScorePill score={t.preScore} label="Pré-score" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tenders/${t.id}`} className="line-clamp-1 text-sm font-medium hover:underline">{t.title}</Link>
                      <p className="truncate text-xs text-muted-foreground">{t.buyerName}</p>
                    </div>
                    <DeadlineBadge deadline={t.deadlineAt} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Échéances (14 jours)</CardTitle></CardHeader>
          <CardContent>
            {d.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Aucune échéance proche sur un dossier suivi.</p> : (
              <ul className="flex flex-col gap-3">
                {d.upcoming.map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link href={`/tenders/${t.id}`} className="line-clamp-2 font-medium hover:underline">{t.title}</Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {formatDate(t.deadlineAt)} <DeadlineBadge deadline={t.deadlineAt} /> <StatusBadge status={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Avis publiés par semaine</CardTitle></CardHeader>
          <CardContent><SimpleBarChart data={d.weekly} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Avis ouverts par pays</CardTitle></CardHeader>
          <CardContent><BarList data={d.byCountry} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Avis ouverts par secteur (CPV)</CardTitle></CardHeader>
          <CardContent><BarList data={d.bySector} /></CardContent>
        </Card>
      </div>
    </>
  );
}
