import Link from "next/link";
import { DeadlineBadge, RecommendationBadge, ScorePill } from "@/components/badges";
import { Card, PageHeader } from "@/components/ui/primitives";
import { fr, PIPELINE_ORDER } from "@/i18n/fr";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";

export const metadata = { title: "Mes candidatures" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const ctx = await requireContext();
  const { mine } = await searchParams;
  const tenders = await prisma.tender.findMany({
    where: { organizationId: ctx.orgId, status: { not: "DETECTED" }, ...(mine ? { assigneeId: ctx.userId } : {}) },
    orderBy: [{ deadlineAt: { sort: "asc", nulls: "last" } }],
    take: 500,
    select: {
      id: true, title: true, buyerName: true, deadlineAt: true, status: true, preScore: true,
      assignee: { select: { name: true } },
      scores: { orderBy: { createdAt: "desc" }, take: 1, select: { total: true, recommendation: true } },
    },
  });
  const columns = PIPELINE_ORDER.filter((s) => s !== "DETECTED");

  return (
    <>
      <PageHeader
        title="Mes candidatures"
        description="Changez le statut depuis la fiche de chaque appel d'offres. Les avis simplement détectés restent dans « Explorer »."
        actions={
          <div className="flex gap-2 text-sm">
            <Link href="/pipeline" className={!mine ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>Tous</Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/pipeline?mine=1" className={mine ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>Affectés à moi</Link>
          </div>
        }
      />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((status) => {
          const items = tenders.filter((t) => t.status === status);
          return (
            <section key={status} className="flex w-72 shrink-0 flex-col gap-2" aria-label={fr.tenderStatus[status]}>
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {fr.tenderStatus[status]} <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{items.length}</span>
              </h2>
              <div className="flex min-h-24 flex-col gap-2 rounded-xl bg-muted/50 p-2">
                {items.map((t) => (
                  <Link key={t.id} href={`/tenders/${t.id}`}>
                    <Card className="p-3 transition-shadow hover:shadow-md">
                      <p className="line-clamp-3 text-sm font-medium">{t.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{t.buyerName}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ScorePill score={t.scores[0]?.total ?? t.preScore} />
                        {t.scores[0] && <RecommendationBadge value={t.scores[0].recommendation} />}
                        <DeadlineBadge deadline={t.deadlineAt} />
                      </div>
                      {t.assignee && <p className="mt-2 text-xs text-muted-foreground">Responsable : {t.assignee.name}</p>}
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
