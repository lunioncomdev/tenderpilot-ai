import Link from "next/link";
import { Bookmark, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { DeadlineBadge, NoticeStateBadge, RecommendationBadge, ScorePill, StatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardContent, EmptyState, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { formatDate, formatEur } from "@/lib/utils";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { parseSearchParams, searchTenders } from "@/server/tenders/search";
import { createManualTenderAction, deleteSearchAction, saveSearchAction } from "./actions";

export const metadata = { title: "Explorer les appels d'offres" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TendersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const filters = parseSearchParams(sp);
  const [res, saved] = await Promise.all([
    searchTenders(ctx.orgId, filters),
    prisma.savedSearch.findMany({ where: { organizationId: ctx.orgId, userId: ctx.userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : [])));
  const pageHref = (p: number) => {
    const q = new URLSearchParams(qs);
    q.set("page", String(p));
    return `/tenders?${q}`;
  };
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const d = (x?: Date) => (x ? x.toISOString().slice(0, 10) : "");
  const advancedOpen = ["minBudget", "maxBudget", "publishedFrom", "deadlineFrom", "deadlineTo", "minScore", "cpv", "contractType", "procedureType", "maxDurationMonths", "sort", "includeExpired", "includeClosed", "includeDuplicates"].some((k) => !!sp[k]);

  return (
    <>
      <PageHeader
        title="Explorer les appels d'offres"
        description={`${res.total.toLocaleString("fr-FR")} consultation(s) correspondante(s). Pré-score calculé sur les métadonnées de l'avis ; le score complet nécessite l'analyse du DCE.`}
        actions={
          <details className="relative">
            <summary className={buttonVariants({ variant: "outline" }) + " cursor-pointer list-none"}>
              <Plus /> Saisie manuelle
            </summary>
            <Card className="absolute right-0 z-10 mt-2 w-[min(90vw,28rem)] p-4">
              <ActionForm action={createManualTenderAction} className="flex flex-col gap-3">
                <Field label="Objet"><Input name="title" required /></Field>
                <Field label="Acheteur"><Input name="buyerName" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pays (ISO)"><Input name="buyerCountry" defaultValue="FR" maxLength={2} required /></Field>
                  <Field label="Montant estimé (€)"><Input name="estimatedValue" type="number" min={0} /></Field>
                </div>
                <Field label="Date limite"><Input name="deadlineAt" type="datetime-local" /></Field>
                <Field label="Lien de la consultation"><Input name="noticeUrl" type="url" /></Field>
                <Field label="Description"><Textarea name="description" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublicMarket" defaultChecked /> Marché public</label>
                <SubmitButton>Créer</SubmitButton>
              </ActionForm>
            </Card>
          </details>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-5">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
            <Field label="Mots-clés" className="sm:col-span-2"><Input name="q" defaultValue={filters.q ?? ""} placeholder="ex. TMA application métier" /></Field>
            <Field label="Pays"><Input name="country" defaultValue={filters.country ?? ""} placeholder="FR" maxLength={2} /></Field>
            <Field label="Département / NUTS"><Input name="region" defaultValue={filters.region ?? ""} placeholder="75, FR10…" /></Field>
            <Field label="Source">
              <Select name="origin" defaultValue={filters.origin ?? ""}>
                <option value="">Toutes</option><option value="BOAMP">BOAMP</option><option value="TED">TED</option><option value="MANUAL">Manuelle</option>
              </Select>
            </Field>
            <Field label="Statut">
              <Select name="status" defaultValue={filters.status ?? ""}>
                <option value="">Tous</option>
                {Object.entries(fr.tenderStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <details className="sm:col-span-2 lg:col-span-6" open={advancedOpen}>
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Plus de filtres</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Field label="Budget min (€)"><Input name="minBudget" type="number" min={0} defaultValue={filters.minBudget ?? ""} /></Field>
                <Field label="Budget max (€)"><Input name="maxBudget" type="number" min={0} defaultValue={filters.maxBudget ?? ""} /></Field>
                <Field label="Publié depuis"><Input name="publishedFrom" type="date" defaultValue={d(filters.publishedFrom)} /></Field>
                <Field label="Date limite après"><Input name="deadlineFrom" type="date" defaultValue={d(filters.deadlineFrom)} /></Field>
                <Field label="Date limite avant"><Input name="deadlineTo" type="date" defaultValue={d(filters.deadlineTo)} /></Field>
                <Field label="Pré-score min"><Input name="minScore" type="number" min={0} max={100} defaultValue={filters.minScore ?? ""} /></Field>
                <Field label="Code CPV"><Input name="cpv" defaultValue={filters.cpv ?? ""} placeholder="72212000" /></Field>
                <Field label="Type de prestation">
              <Select name="contractType" defaultValue={filters.contractType ?? ""}>
                <option value="">Tous</option><option value="SERVICES">Services</option><option value="FOURNITURES">Fournitures</option><option value="SUPPLIES">Fournitures (TED)</option><option value="TRAVAUX">Travaux</option>
              </Select>
                </Field>
                <Field label="Procédure"><Input name="procedureType" defaultValue={filters.procedureType ?? ""} placeholder="ouvert, adapté…" /></Field>
                <Field label="Durée max (mois)"><Input name="maxDurationMonths" type="number" min={1} defaultValue={filters.maxDurationMonths ?? ""} /></Field>
                <Field label="Tri">
              <Select name="sort" defaultValue={filters.sort ?? ""}>
                <option value="">Par défaut</option><option value="relevance">Pertinence</option><option value="published">Publication</option>
                <option value="deadline">Date limite</option><option value="score">Pré-score</option><option value="value">Montant</option>
              </Select>
                </Field>
                <div className="flex flex-col justify-end gap-1 text-sm sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="includeExpired" value="1" defaultChecked={filters.includeExpired} /> Inclure les échéances passées</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="includeClosed" value="1" defaultChecked={filters.includeClosed} /> Inclure annulés / attribués</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="includeDuplicates" value="1" defaultChecked={filters.includeDuplicates} /> Afficher les doublons inter-sources</label>
            </div>
              </div>
            </details>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
              <Button type="submit">Rechercher</Button>
              <Link href="/tenders" className={buttonVariants({ variant: "ghost" })}>Réinitialiser</Link>
            </div>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <Bookmark className="size-4 text-muted-foreground" />
            {saved.map((s) => (
              <span key={s.id} className="inline-flex items-center rounded-full border pl-3 text-sm">
                <Link href={`/tenders?${new URLSearchParams(s.filters as Record<string, string>)}`} className="hover:underline">{s.name}</Link>
                <ActionForm action={deleteSearchAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="p-1.5 text-muted-foreground hover:text-danger" aria-label={`Supprimer ${s.name}`}><Trash2 className="size-3" /></button>
                </ActionForm>
              </span>
            ))}
            <ActionForm action={saveSearchAction} className="flex items-center gap-2" resetOnSuccess>
              <input type="hidden" name="query" value={qs.toString()} />
              <Input name="name" placeholder="Nom de la recherche" className="h-8 w-48" required />
              <SubmitButton size="sm" variant="outline">Enregistrer</SubmitButton>
            </ActionForm>
          </div>
        </CardContent>
      </Card>

      {res.items.length === 0 ? (
        <EmptyState title="Aucun appel d'offres">
          Lancez une synchronisation depuis <Link className="text-primary underline" href="/sources">Sources</Link> ou élargissez les filtres.
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <thead className="border-b">
              <tr><Th>Score</Th><Th>Consultation</Th><Th>Montant</Th><Th>Publication</Th><Th>Échéance</Th><Th>Statut</Th></tr>
            </thead>
            <tbody className="divide-y">
              {res.items.map((t) => {
                const s = t.scores[0];
                return (
                  <tr key={t.id} className="hover:bg-muted/50">
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <ScorePill score={s?.total ?? t.preScore} label={s ? "Score complet" : "Pré-score"} />
                        {s && <RecommendationBadge value={s.recommendation} />}
                      </div>
                    </Td>
                    <Td className="max-w-xl">
                      <Link href={`/tenders/${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{t.buyerName || "Acheteur non précisé"}</span>
                        <span>·</span>
                        <Badge tone="outline">{t.origin}{t.publicationRef ? ` ${t.publicationRef}` : ""}</Badge>
                        {t.buyerCountry && <span>{t.buyerCountry}{t.region ? ` · ${t.region}` : ""}</span>}
                        <NoticeStateBadge state={t.noticeState} />
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatEur(t.estimatedValue?.toString(), t.currency)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(t.publishedAt)}</Td>
                    <Td className="whitespace-nowrap">
                      <div className="flex flex-col gap-0.5"><span>{formatDate(t.deadlineAt)}</span><DeadlineBadge deadline={t.deadlineAt} /></div>
                    </Td>
                    <Td><StatusBadge status={t.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Page {res.page} / {pages}</span>
            <div className="flex gap-2">
              {res.page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={pageHref(res.page - 1)}><ChevronLeft /> Précédente</Link>}
              {res.page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={pageHref(res.page + 1)}>Suivante <ChevronRight /></Link>}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
