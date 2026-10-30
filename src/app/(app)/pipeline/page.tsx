import Link from "next/link";
import type { TenderStatus } from "@prisma/client";
import { DeadlineBadge, RecommendationBadge, ScorePill, StatusBadge } from "@/components/badges";
import { parseSort, SortTh, sortRows } from "@/components/sortable";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/primitives";
import { PIPELINE_ORDER } from "@/i18n/fr";
import { cn, formatDate, formatEur } from "@/lib/utils";
import { pieceProgress } from "@/server/applications/pieces";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";

export const metadata = { title: "Mes candidatures" };

const TABS = {
  "en-cours": { label: "En cours", statuses: ["IN_PREPARATION", "IN_VALIDATION", "READY_TO_SUBMIT"] },
  qualifier: { label: "À qualifier", statuses: ["TO_ANALYZE", "QUALIFIED", "GO"] },
  deposees: { label: "Déposées", statuses: ["SUBMITTED", "AWAITING_DECISION"] },
  terminees: { label: "Terminées", statuses: ["WON", "LOST"] },
} satisfies Record<string, { label: string; statuses: TenderStatus[] }>;

type TabKey = keyof typeof TABS;
const TAB_ORDER: TabKey[] = ["en-cours", "qualifier", "deposees", "terminees"];

const SORT_KEYS = ["deadline", "title", "status", "score", "dossier", "memoire", "conformite", "value", "assignee"] as const;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : undefined;
  const mine = typeof sp.mine === "string" ? sp.mine : undefined;
  const tab: TabKey = rawTab && rawTab in TABS ? (rawTab as TabKey) : "en-cours";
  // Les candidatures terminées se lisent de la plus récente à la plus ancienne.
  const sort = parseSort(sp, SORT_KEYS, { key: "deadline", dir: tab === "terminees" ? "desc" : "asc" });
  const base = { organizationId: ctx.orgId, ...(mine ? { assigneeId: ctx.userId } : {}) };

  const [counts, rows] = await Promise.all([
    prisma.tender.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.tender.findMany({
      where: { ...base, status: { in: TABS[tab].statuses } },
      orderBy: [{ deadlineAt: { sort: "asc", nulls: "last" } }],
      take: 500,
      select: {
        id: true, title: true, buyerName: true, deadlineAt: true, status: true, preScore: true,
        estimatedValue: true, currency: true,
        assignee: { select: { name: true } },
        pieces: { select: { status: true } },
        scores: { orderBy: { createdAt: "desc" }, take: 1, select: { total: true, recommendation: true } },
        proposals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { sections: { select: { status: true } }, compliance: { select: { status: true } } },
        },
      },
    }),
  ]);
  const ratio = (items: Array<{ status: string }> | undefined, ok: string) =>
    items?.length ? items.filter((i) => i.status === ok).length / items.length : null;
  const tenders = sortRows(rows, sort, {
    deadline: (t) => t.deadlineAt,
    title: (t) => t.title,
    status: (t) => PIPELINE_ORDER.indexOf(t.status),
    score: (t) => t.scores[0]?.total ?? t.preScore,
    dossier: (t) => {
      const p = pieceProgress(t.pieces);
      return p.total ? p.done / p.total : null;
    },
    memoire: (t) => ratio(t.proposals[0]?.sections, "VALIDATED"),
    conformite: (t) => ratio(t.proposals[0]?.compliance, "COMPLIANT"),
    value: (t) => (t.estimatedValue === null ? null : Number(t.estimatedValue)),
    assignee: (t) => t.assignee?.name,
  });
  const countOf = (k: TabKey) =>
    counts.filter((c) => (TABS[k].statuses as TenderStatus[]).includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  const href = (t: TabKey, m = mine) => `/pipeline?${new URLSearchParams({ tab: t, ...(m ? { mine: "1" } : {}) })}`;
  const toggleMine = (m?: string) =>
    `/pipeline?${new URLSearchParams({ tab, ...(m ? { mine: "1" } : {}), ...(sp.sort ? { sort: sort.key, dir: sort.dir } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Mes candidatures"
        description="Candidatures triées par date limite. Cliquez « Candidater » sur un appel d'offres pour le suivre ici, puis générez son dossier de candidature depuis sa fiche."
        actions={
          <div className="flex gap-2 text-sm">
            <Link href={toggleMine()} className={!mine ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>Tous</Link>
            <span className="text-muted-foreground">·</span>
            <Link href={toggleMine("1")} className={mine ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>Affectés à moi</Link>
          </div>
        }
      />

      <nav className="mb-4 flex flex-wrap gap-1 border-b" aria-label="Étapes">
        {TAB_ORDER.map((k) => (
          <Link
            key={k}
            href={href(k)}
            aria-current={k === tab ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
              k === tab ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TABS[k].label}
            <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{countOf(k)}</span>
          </Link>
        ))}
      </nav>

      {tenders.length === 0 ? (
        <EmptyState title="Aucune candidature à cette étape">
          {tab === "en-cours"
            ? "Cliquez « Candidater » sur un appel d'offres (Explorer ou sa fiche) pour le suivre ici."
            : <>Les appels d&apos;offres se trouvent dans <Link className="text-primary underline" href="/tenders">Explorer</Link>.</>}
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <thead className="border-b">
              <tr>
                <SortTh label="Échéance" column="deadline" sort={sort} params={sp} />
                <SortTh label="Consultation" column="title" sort={sort} params={sp} />
                <SortTh label="Statut" column="status" sort={sort} params={sp} />
                {tab === "qualifier" ? (
                  <SortTh label="Score" column="score" sort={sort} params={sp} firstDir="desc" />
                ) : tab === "en-cours" ? (
                  <>
                    <SortTh label="Dossier" column="dossier" sort={sort} params={sp} firstDir="desc" />
                    <SortTh label="Mémoire" column="memoire" sort={sort} params={sp} firstDir="desc" />
                    <SortTh label="Conformité" column="conformite" sort={sort} params={sp} firstDir="desc" />
                  </>
                ) : (
                  <SortTh label="Montant" column="value" sort={sort} params={sp} firstDir="desc" />
                )}
                <SortTh label="Responsable" column="assignee" sort={sort} params={sp} />
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map((t) => {
                const proposal = t.proposals[0];
                const score = t.scores[0];
                return (
                  <tr key={t.id} className="hover:bg-muted/50">
                    <Td className="whitespace-nowrap">
                      <div className="flex flex-col items-start gap-0.5">
                        {tab === "en-cours" || tab === "qualifier" ? <DeadlineBadge deadline={t.deadlineAt} /> : null}
                        <span className="text-xs text-muted-foreground">{formatDate(t.deadlineAt)}</span>
                      </div>
                    </Td>
                    <Td className="max-w-xl">
                      <Link href={`/tenders/${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.buyerName || "Acheteur non précisé"}</p>
                    </Td>
                    <Td><StatusBadge status={t.status} /></Td>
                    {tab === "qualifier" ? (
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <ScorePill score={score?.total ?? t.preScore} label={score ? "Score complet" : "Pré-score"} />
                          {score && <RecommendationBadge value={score.recommendation} />}
                        </div>
                      </Td>
                    ) : tab === "en-cours" ? (
                      <>
                        <Td>
                          {t.pieces.length ? (
                            <Progress {...pieceProgress(t.pieces)} unit="pièces prêtes" />
                          ) : (
                            <Link href={`/tenders/${t.id}`} className="text-xs text-primary hover:underline">Générer le dossier</Link>
                          )}
                        </Td>
                        <Td>
                          {proposal?.sections.length ? (
                            <Progress done={proposal.sections.filter((s) => s.status === "VALIDATED").length} total={proposal.sections.length} unit="validées" />
                          ) : (
                            <span className="text-xs text-muted-foreground">Pas de mémoire</span>
                          )}
                        </Td>
                        <Td>
                          {proposal?.compliance.length ? (
                            <Progress done={proposal.compliance.filter((c) => c.status === "COMPLIANT").length} total={proposal.compliance.length} unit="conformes" />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </Td>
                      </>
                    ) : (
                      <Td className="whitespace-nowrap tabular-nums">{formatEur(t.estimatedValue?.toString(), t.currency)}</Td>
                    )}
                    <Td className="whitespace-nowrap text-sm">{t.assignee?.name ?? <span className="text-muted-foreground">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function Progress({ done, total, unit }: { done: number; total: number; unit: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex min-w-32 flex-col gap-1" title={`${done} / ${total} ${unit}`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{done}/{total} {unit}</span>
    </div>
  );
}
