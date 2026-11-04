import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Calculator, ClipboardList, Download, ExternalLink, FileText, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { DeadlineBadge, NoticeStateBadge, RecommendationBadge, ScorePill, StatusBadge } from "@/components/badges";
import { AutoRefresh, UploadDocuments } from "@/components/client-utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Select, Textarea } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { formatDate, formatDateTime, formatEur, NOT_SPECIFIED } from "@/lib/utils";
import { aiStatus } from "@/server/ai/gateway";
import { compareLotNumbers, lotLabel, visiblePieces } from "@/server/applications/lots";
import { loadReadiness } from "@/server/applications/readiness";
import { APPLICATION_STATUSES, pieceProgress, PRE_APPLICATION_STATUSES } from "@/server/applications/pieces";
import { boampNoticePdfUrl } from "@/server/connectors/boamp";
import type { TenderAnalysisResult } from "@/server/analysis/schema";
import { requireContext } from "@/server/auth/context";
import { linkCompanyDocs } from "@/server/company/documents";
import { hasRole } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { detectPlatform } from "@/server/dce/platforms";
import { settingsProblem } from "@/server/dce/retrieve-service";
import { env } from "@/server/env";
import { loadPricing, priceTemplates } from "@/server/pricing/pricing-service";
import { LEVEL_LABELS, scoreLevel, type CriterionResult, type EliminatoryCheck } from "@/server/scoring/engine";
import { AnalysisView } from "./analysis-view";
import { ApplicationPieces } from "./application-pieces";
import { LotSelector } from "./lot-selector";
import { ReadinessPanel } from "./readiness-panel";
import {
  preparePricingAction,
  addCommentAction, applyAction, retrieveDceAction, createProposalAction, deleteDocumentAction, generateApplicationAction, importNoticePdfAction, recomputeScoreAction,
  reprocessDocumentAction, requestAnalysisAction, setDocumentKindAction, updateWorkflowAction,
} from "./actions";

const ELIM_TONE = { PASS: "success", FAIL: "danger", UNKNOWN: "warning", WARN: "warning" } as const;
const ELIM_LABEL = { PASS: "OK", FAIL: "Non satisfait", UNKNOWN: "À vérifier", WARN: "Attention" } as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await prisma.tender.findFirst({ where: { id, organizationId: ctx.orgId }, select: { title: true } });
  return { title: t ? t.title.slice(0, 70) : "Appel d'offres" };
}

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const tender = await prisma.tender.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      documents: { orderBy: { createdAt: "asc" } },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      proposals: { select: { id: true, title: true, status: true, lotId: true }, orderBy: { createdAt: "asc" } },
      lots: true,
      pieces: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, sizeBytes: true } } },
      },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      duplicateOf: { select: { id: true, title: true, origin: true } },
      duplicates: { select: { id: true, origin: true, publicationRef: true } },
    },
  });
  if (!tender) notFound();
  const [members, history, companyDocs, dceSettings] = await Promise.all([
    prisma.membership.findMany({ where: { organizationId: ctx.orgId }, include: { user: { select: { id: true, name: true } } } }),
    prisma.auditLog.findMany({ where: { organizationId: ctx.orgId, entityType: "Tender", entityId: tender.id }, orderBy: { createdAt: "desc" }, take: 15, include: { user: { select: { name: true } } } }),
    prisma.companyDocument.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, select: { id: true, type: true, label: true, filename: true, validUntil: true } }),
    prisma.dceRetrievalSettings.findUnique({ where: { organizationId: ctx.orgId } }),
  ]);
  const templates = await priceTemplates(ctx.orgId, tender.id);
  const pricingRows = await prisma.pricing.findMany({ where: { tenderId: tender.id, organizationId: ctx.orgId }, select: { id: true, documentId: true, lotId: true } });
  const pricings = new Map(
    await Promise.all(pricingRows.map(async (p) => [p.documentId, { id: p.id, lotId: p.lotId, totals: (await loadPricing(ctx.orgId, p.id)).totals }] as const)),
  );
  const platform = detectPlatform(tender.documentsUrl);
  const dceProblem = settingsProblem(dceSettings);
  const platformAccount = platform.kind === "account" || platform.kind === "generic"
    ? await prisma.platformAccount.findUnique({ where: { organizationId_host: { organizationId: ctx.orgId, host: platform.host } }, select: { login: true } })
    : null;

  const analysis = tender.analyses[0];
  const score = tender.scores[0];
  const canEdit = hasRole(ctx.role, "MEMBER");
  const ai = await aiStatus(ctx.orgId);
  const extracted = tender.documents.filter((d) => d.status === "EXTRACTED" && !d.mimeType.includes("zip")).length;
  const canApply = PRE_APPLICATION_STATUSES.includes(tender.status);
  const inApplication = APPLICATION_STATUSES.includes(tender.status);
  const lots = [...tender.lots].sort((a, b) => compareLotNumbers(a.number, b.number));
  const selectedLots = lots.filter((l) => l.selected);
  const pieces = visiblePieces(tender.pieces, selectedLots.map((l) => l.id));
  const hiddenLotPieces = tender.pieces.filter((p) => p.lotId && !selectedLots.some((l) => l.id === p.lotId)).length;
  const progress = pieceProgress(pieces);
  const pieceViews = pieces.map(({ id, key, group, label, detail, source, fromDce, status, note, files, lotId }) => ({
    id, key, group, label, detail, source, fromDce, status, note, files, lotId, profile: linkCompanyDocs({ key, detail }, companyDocs, tender.deadlineAt),
  }));
  const proposalFor = (lotId: string | null) => tender.proposals.find((p) => p.lotId === lotId)?.id;
  const canCreateProposal = canEdit && analysis?.status === "DONE";
  const pieceSections = [
    { key: "candidature", title: fr.pieceGroup.CANDIDATURE, group: "CANDIDATURE" as const, lotId: null, proposalId: undefined },
    { key: "offre", title: selectedLots.length ? `${fr.pieceGroup.OFFRE} — pièces communes à tous les lots` : fr.pieceGroup.OFFRE, group: "OFFRE" as const, lotId: null, proposalId: proposalFor(null) },
    ...selectedLots.map((l) => ({ key: l.id, title: `${fr.pieceGroup.OFFRE} — ${lotLabel(l)}`, group: "OFFRE" as const, lotId: l.id, proposalId: proposalFor(l.id) })),
  ];
  const lotNumber = new Map(lots.map((l) => [l.id, l.number]));
  const readiness = inApplication || tender.pieces.length ? await loadReadiness(ctx.orgId, tender.id) : null;
  const isAdmin = hasRole(ctx.role, "ADMIN");
  // Pièces requises dont la pièce du profil manque, est expirée ou expire avant la date limite.
  const docIssues = pieceViews.filter((p) => p.status !== "NOT_APPLICABLE" && p.profile && (p.profile.missing.length > 0 || p.profile.docs.some((d) => d.alert === "expired" || d.alert === "before-deadline")));
  const processing = tender.documents.some((d) => d.status === "UPLOADED" || d.status === "PROCESSING") || analysis?.status === "PENDING" || analysis?.status === "RUNNING";

  return (
    <>
      <AutoRefresh active={processing} />
      <div className="mb-6 flex flex-col gap-3">
        <Link href="/tenders" className="text-sm text-muted-foreground hover:underline">← Appels d&apos;offres</Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{fr.origin[tender.origin]}{tender.publicationRef ? ` · ${tender.publicationRef}` : ""}</Badge>
          <StatusBadge status={tender.status} />
          <NoticeStateBadge state={tender.noticeState} />
          <DeadlineBadge deadline={tender.deadlineAt} />
        </div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{tender.title}</h1>
        <p className="text-muted-foreground">{tender.buyerName || "Acheteur non précisé"}</p>
        <div className="flex flex-wrap gap-2">
          {canEdit && canApply && (
            <ActionForm action={applyAction}>
              <input type="hidden" name="tenderId" value={tender.id} />
              <SubmitButton size="sm" pendingText="Candidature…"><Send /> Candidater</SubmitButton>
            </ActionForm>
          )}
          {inApplication && <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/pipeline"><Briefcase /> Suivre dans Mes candidatures</Link>}
          {tender.noticeUrl && <a className={buttonVariants({ variant: "outline", size: "sm" })} href={tender.noticeUrl} target="_blank" rel="noreferrer"><ExternalLink /> Avis officiel</a>}
          {tender.documentsUrl && <a className={buttonVariants({ variant: "outline", size: "sm" })} href={tender.documentsUrl} target="_blank" rel="noreferrer"><ExternalLink /> Dossier de consultation (DCE)</a>}
          {tender.origin === "BOAMP" && tender.publishedAt && (
            <a className={buttonVariants({ variant: "outline", size: "sm" })} href={boampNoticePdfUrl(tender.externalId, tender.publishedAt)} target="_blank" rel="noreferrer"><FileText /> Extrait de l&apos;avis (PDF)</a>
          )}
        </div>
        {tender.duplicateOf && (
          <Alert>Publication en doublon de <Link className="text-primary underline" href={`/tenders/${tender.duplicateOf.id}`}>{tender.duplicateOf.title}</Link> ({tender.duplicateOf.origin}).</Alert>
        )}
        {tender.duplicates.length > 0 && <p className="text-xs text-muted-foreground">Également publié sur : {tender.duplicates.map((d) => `${d.origin} ${d.publicationRef ?? ""}`).join(", ")}</p>}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {(inApplication || tender.pieces.length > 0) && (
            <Card id="dossier" className="scroll-mt-20">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Dossier de candidature</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                      <ActionForm action={generateApplicationAction}>
                        <input type="hidden" name="tenderId" value={tender.id} />
                        <SubmitButton size="sm" variant={tender.pieces.length ? "outline" : "default"} pendingText="Génération…">
                          <ClipboardList /> {tender.pieces.length ? "Mettre à jour depuis l'analyse" : "Générer le dossier de candidature"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {tender.pieces.length > 0 && (
                      <a className={buttonVariants({ size: "sm" })} href={`/api/v1/tenders/${tender.id}/dossier`} download>
                        <Download /> Télécharger le dossier (ZIP)
                      </a>
                    )}
                  </div>
                </div>
                <CardDescription>
                  {tender.pieces.length === 0
                    ? analysis?.status === "DONE"
                      ? "Liste des pièces à réunir : pièces usuelles d'un marché public et pièces exigées par le DCE analysé."
                      : "Sans analyse du DCE, seules les pièces usuelles seront listées. Analysez le DCE pour y ajouter ses exigences."
                    : `${progress.done} / ${progress.total} pièce(s) prête(s). Les pièces « Non requises » ne comptent pas.`}
                </CardDescription>
              </CardHeader>
              {(lots.length > 0 || canEdit) && (
                <CardContent className={tender.pieces.length ? "pb-0" : undefined}>
                  <LotSelector
                    tenderId={tender.id}
                    canEdit={canEdit}
                    hiddenPieces={hiddenLotPieces}
                    lots={lots.map((l) => ({ id: l.id, number: l.number, title: l.title, selected: l.selected, fromAnalysis: l.fromAnalysis }))}
                  />
                </CardContent>
              )}
              {tender.pieces.length > 0 && (
                <CardContent className="flex flex-col gap-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total} aria-label="Avancement du dossier">
                    <div className={`h-full rounded-full ${progress.total && progress.done === progress.total ? "bg-success" : "bg-primary"}`} style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                  {docIssues.length > 0 && (
                    <Alert tone="warning">
                      {docIssues.length} pièce(s) à compléter ou mettre à jour dans le <Link href="/company#pieces" className="underline">profil entreprise</Link> : {docIssues.map((p) => p.label).join(", ")}.
                    </Alert>
                  )}
                  <ApplicationPieces tenderId={tender.id} canEdit={canEdit} canCreateProposal={canCreateProposal} sections={pieceSections} pieces={pieceViews} maxMb={env().UPLOAD_MAX_MB} />
                </CardContent>
              )}
            </Card>
          )}

          {(inApplication || templates.length > 0) && (
            <Card id="chiffrage" className="scroll-mt-20">
              <CardHeader>
                <CardTitle>Chiffrage</CardTitle>
                <CardDescription>
                  Bordereaux de prix du DCE (BPU, DPGF, DQE au format .xlsx) remplis à partir des jours par profil et des TJM du profil entreprise. Le modèle de l&apos;acheteur est conservé.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun classeur .xlsx dans le DCE. Importez le BPU ou la DPGF au format Excel dans les documents ci-dessous.</p>
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {templates.map((d) => {
                      const pr = pricings.get(d.id);
                      return (
                        <li key={d.id} className="flex flex-wrap items-center gap-3 p-3">
                          <Calculator className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {d.filename} <Badge className="ml-1 align-middle">{fr.documentKind[d.kind]}</Badge>
                              {pr?.lotId && lotNumber.has(pr.lotId) && <Badge tone="primary" className="ml-1 align-middle">Lot {lotNumber.get(pr.lotId)}</Badge>}
                            </p>
                            {pr && (
                              <p className="text-xs text-muted-foreground">
                                {pr.totals.priced} / {pr.totals.lines} ligne(s) chiffrée(s){pr.totals.totalHt > 0 ? ` — total ${formatEur(pr.totals.totalHt)} HT` : ""}
                              </p>
                            )}
                          </div>
                          {pr ? (
                            <div className="flex items-center gap-2">
                              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/tenders/${tender.id}/pricing/${pr.id}`}>Ouvrir le chiffrage</Link>
                              <a className={buttonVariants({ size: "sm", variant: "ghost" })} href={`/api/v1/pricings/${pr.id}/export`} download aria-label="Télécharger le bordereau rempli"><Download /></a>
                            </div>
                          ) : canEdit ? (
                            <ActionForm action={preparePricingAction}>
                              <input type="hidden" name="tenderId" value={tender.id} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <SubmitButton size="sm" variant="outline" pendingText="Analyse du bordereau…"><Calculator /> Chiffrer ce bordereau</SubmitButton>
                            </ActionForm>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Informations de l&apos;avis</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {[
                  ["Montant estimé", formatEur(tender.estimatedValue?.toString(), tender.currency)],
                  ["Date limite", tender.deadlineAt ? formatDateTime(tender.deadlineAt) : NOT_SPECIFIED],
                  ["Publication", formatDate(tender.publishedAt)],
                  ["Procédure", tender.procedureType ?? NOT_SPECIFIED],
                  ["Type d'avis", tender.noticeType ?? NOT_SPECIFIED],
                  ["Nature", tender.contractType ?? NOT_SPECIFIED],
                  ["Pays / lieu", [tender.buyerCountry, tender.region].filter(Boolean).join(" · ") || NOT_SPECIFIED],
                  ["Durée", tender.durationMonths ? `${tender.durationMonths} mois` : NOT_SPECIFIED],
                  ["Codes CPV", tender.cpvCodes.join(", ") || NOT_SPECIFIED],
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              {tender.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{tender.description}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dossier de consultation (DCE)</CardTitle>
              <CardDescription>
                Le dossier de consultation est publié sur la plateforme de l&apos;acheteur. Sur les plateformes Atexo (PLACE, Maximilien…), il est retiré automatiquement ;
                ailleurs, téléchargez-le (bouton « Dossier de consultation ») puis importez-le ici. Aucun contournement d&apos;accès n&apos;est effectué.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {platform.kind === "atexo" && canEdit && (
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {dceProblem ? (
                      <span>Retrait automatique possible sur {platform.name}, mais {dceProblem}. <Link className="text-primary underline" href="/settings">Configurer</Link></span>
                    ) : (
                      <ActionForm action={retrieveDceAction}>
                        <input type="hidden" name="tenderId" value={tender.id} />
                        <SubmitButton size="sm" variant="secondary" pendingText="Lancement…"><Download /> Récupérer le DCE sur {platform.name}</SubmitButton>
                      </ActionForm>
                    )}
                    {tender.dceFetchedAt && <span className="text-xs text-muted-foreground">Dernier retrait : {formatDateTime(tender.dceFetchedAt)}</span>}
                  </div>
                  {!dceProblem && <span className="text-xs text-muted-foreground">Règlement de consultation et DCE complet, retirés en mode {dceSettings?.mode === "IDENTIFIED" ? `identifié (${dceSettings.legalName})` : "anonyme"}.</span>}
                </div>
              )}
              {(platform.kind === "account" || platform.kind === "generic") && (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm">
                  DCE sur <strong>{platform.name}</strong> : retrait automatique non pris en charge.{" "}
                  {platformAccount ? <>Compte enregistré : <strong>{platformAccount.login}</strong>.</> : platform.kind === "account" ? <>Plateforme à compte : <Link className="text-primary underline" href="/settings">enregistrez vos identifiants</Link>.</> : null}
                </p>
              )}
              {platform.kind === "none" && <p className="text-sm text-muted-foreground">L&apos;avis ne donne pas de lien vers le dossier de consultation (projet d&apos;achat ou avis sans profil acheteur).</p>}
              {tender.dceFetchError && <Alert tone="warning">Retrait du DCE : {tender.dceFetchError}</Alert>}
              {canEdit && tender.origin === "BOAMP" && !tender.documents.some((d) => d.kind === "AVIS") && (
                <ActionForm action={importNoticePdfAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tenderId" value={tender.id} />
                  <SubmitButton size="sm" variant="secondary" pendingText="Import…"><Download /> Importer l&apos;extrait de l&apos;avis BOAMP (PDF)</SubmitButton>
                  <span className="text-xs text-muted-foreground">Récupéré automatiquement depuis boamp.fr et ajouté aux pièces analysables.</span>
                </ActionForm>
              )}
              {canEdit && <UploadDocuments tenderId={tender.id} maxMb={env().UPLOAD_MAX_MB} />}
              {tender.documents.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {tender.documents.map((d) => (
                    <li key={d.id} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${d.parentId ? "pl-8" : ""}`}>
                      <FileText className="size-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{d.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {(d.sizeBytes / 1024).toFixed(0)} Ko{d.pageCount ? ` · ${d.pageCount} ${d.mimeType.includes("zip") ? "fichier(s)" : "page(s)"}` : ""}
                          {d.error && <span className={d.status === "EXTRACTED" ? "text-warning" : "text-danger"}> · {d.error}</span>}
                        </p>
                      </div>
                      <Badge tone={d.status === "EXTRACTED" ? "success" : d.status === "FAILED" || d.status === "NEEDS_OCR" ? "danger" : "primary"}>{fr.documentStatus[d.status]}</Badge>
                      {canEdit && !d.mimeType.includes("zip") ? (
                        <ActionForm action={setDocumentKindAction} className="flex items-center gap-1">
                          <input type="hidden" name="documentId" value={d.id} />
                          <Select name="kind" defaultValue={d.kind} className="h-8 w-40 text-xs">
                            {Object.entries(fr.documentKind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </Select>
                          <SubmitButton size="sm" variant="ghost">OK</SubmitButton>
                        </ActionForm>
                      ) : (
                        <Badge>{fr.documentKind[d.kind]}</Badge>
                      )}
                      <a className={buttonVariants({ variant: "ghost", size: "icon" })} href={`/api/v1/documents/${d.id}/download`} aria-label="Télécharger"><Download /></a>
                      {canEdit && (d.status === "FAILED" || d.status === "UPLOADED") && (
                        <ActionForm action={reprocessDocumentAction}><input type="hidden" name="documentId" value={d.id} /><Button variant="ghost" size="icon" aria-label="Relancer l'extraction"><RefreshCw /></Button></ActionForm>
                      )}
                      {canEdit && !d.parentId && (
                        <ActionForm action={deleteDocumentAction} confirm="Supprimer ce document ?"><input type="hidden" name="documentId" value={d.id} /><Button variant="ghost" size="icon" aria-label="Supprimer"><Trash2 /></Button></ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Analyse IA du DCE</CardTitle>
                {canEdit && (
                  <ActionForm action={requestAnalysisAction}>
                    <input type="hidden" name="tenderId" value={tender.id} />
                    <SubmitButton size="sm" disabled={!ai.enabled || extracted === 0 || processing} pendingText="Lancement…">
                      <Sparkles /> {analysis?.status === "DONE" ? "Relancer l'analyse" : "Analyser le DCE"}
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
              <CardDescription>
                {!ai.enabled ? `IA indisponible : ${ai.reason}.` : extracted === 0 ? "Importez au moins un document pour lancer l'analyse." : `Modèle : ${ai.model}. Chaque information est reliée à sa source.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!analysis ? (
                <EmptyState title="Aucune analyse">L&apos;analyse extrait objet, conditions, exigences, critères, pièces et risques avec leurs références documentaires.</EmptyState>
              ) : analysis.status === "FAILED" ? (
                <Alert tone="danger">Échec de l&apos;analyse : {analysis.error}</Alert>
              ) : analysis.status !== "DONE" ? (
                <Alert>Analyse en cours… (cette page se met à jour automatiquement)</Alert>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">Analyse du {formatDateTime(analysis.finishedAt)} · {analysis.model} · prompt {analysis.promptVersion}</p>
                  <AnalysisView result={analysis.result as unknown as TenderAnalysisResult} stats={analysis.citationStats as { total: number; verified: number; excludedDocuments?: string[] } | null} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Décision</CardTitle>
                {canEdit && (
                  <ActionForm action={recomputeScoreAction}>
                    <input type="hidden" name="tenderId" value={tender.id} />
                    <SubmitButton size="sm" variant="ghost"><RefreshCw /> Calculer</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {!score ? (
                <div className="flex items-center gap-3">
                  <ScorePill score={tender.preScore} />
                  <p className="text-muted-foreground">Pré-score (métadonnées de l&apos;avis uniquement). Cliquez sur « Calculer » pour le détail.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-4xl font-semibold tabular-nums">{score.total}</span>
                    <div>
                      <RecommendationBadge value={score.recommendation} />
                      <p className="mt-1 text-xs text-muted-foreground">{LEVEL_LABELS[scoreLevel(score.total)]}{score.analysisId ? " · avec analyse du DCE" : " · sans analyse du DCE"}</p>
                    </div>
                  </div>
                  <p>{score.justification}</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {(score.breakdown as CriterionResult[]).some((b) => String(b.key).startsWith("buyer-"))
                      ? "Critères et pondérations de l'acheteur (DCE)"
                      : "Barème interne (l'acheteur n'a pas publié de critères pondérés)"}
                  </p>
                  <div className="flex flex-col gap-2">
                    {(score.breakdown as CriterionResult[]).map((b) => (
                      <div key={b.key} title={b.rationale}>
                        <div className="flex justify-between text-xs"><span>{b.label}</span><span className="tabular-nums">{b.points} / {b.weight}</span></div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(b.ratio * 100)}%` }} /></div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{b.rationale}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="mb-1.5 font-semibold">Critères éliminatoires</h4>
                    <ul className="flex flex-col gap-1.5">
                      {(score.eliminatory as EliminatoryCheck[]).map((e) => (
                        <li key={e.key} className="flex items-start gap-2">
                          <Badge tone={ELIM_TONE[e.status]}>{ELIM_LABEL[e.status]}</Badge>
                          <span><span className="font-medium">{e.label}</span> — <span className="text-muted-foreground">{e.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {[["Points forts", score.strengths], ["Points faibles", score.weaknesses], ["Informations manquantes", score.missingInfo], ["Risques", score.risks]].map(([title, items]) =>
                    (items as string[]).length ? (
                      <div key={title as string}>
                        <h4 className="mb-1 font-semibold">{title as string}</h4>
                        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{(items as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    ) : null,
                  )}
                  <p className="text-xs text-muted-foreground">Calculé le {formatDateTime(score.createdAt)} — moteur déterministe. Barème interne modifiable dans Paramètres ; les critères de l&apos;acheteur priment quand il les publie.</p>
                </>
              )}
            </CardContent>
          </Card>

          {readiness && <ReadinessPanel tenderId={tender.id} readiness={readiness} />}

          <Card>
            <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ActionForm action={updateWorkflowAction} className="flex flex-col gap-3">
                <input type="hidden" name="tenderId" value={tender.id} />
                <Select name="status" defaultValue={tender.status} disabled={!canEdit} aria-label="Statut">
                  {Object.entries(fr.tenderStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Select name="assigneeId" defaultValue={tender.assigneeId ?? ""} disabled={!canEdit} aria-label="Responsable">
                  <option value="">Non affecté</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
                </Select>
                {readiness && !readiness.ready && isAdmin && (
                  <details className="rounded-md border p-2 text-xs">
                    <summary className="cursor-pointer select-none text-muted-foreground">Déroger au contrôle avant dépôt (administrateur)</summary>
                    <label className="mt-2 flex items-center gap-2">
                      <input type="checkbox" name="override" />
                      Passer « Prête à déposer » / « Déposée » malgré {readiness.blockers} point(s) bloquant(s)
                    </label>
                    <Textarea name="overrideReason" placeholder="Motif (ex. AE signé déposé à part sur la plateforme)" className="mt-2 min-h-14 text-xs" maxLength={1000} />
                    <p className="mt-1 text-muted-foreground">La dérogation et son motif sont inscrits au journal d&apos;audit.</p>
                  </details>
                )}
                {canEdit && <SubmitButton variant="outline" size="sm">Enregistrer</SubmitButton>}
              </ActionForm>
              <div className="border-t pt-4">
                {selectedLots.length ? (
                  <div className="flex flex-col gap-2">
                    {selectedLots.map((l) => {
                      const pid = proposalFor(l.id);
                      return pid ? (
                        <Link key={l.id} href={`/proposals/${pid}`} className={buttonVariants({ variant: "secondary" }) + " w-full"}><FileText /> Mémoire — lot {l.number}</Link>
                      ) : canEdit ? (
                        <ActionForm key={l.id} action={createProposalAction}>
                          <input type="hidden" name="tenderId" value={tender.id} />
                          <input type="hidden" name="lotId" value={l.id} />
                          <SubmitButton variant="outline" className="w-full" disabled={analysis?.status !== "DONE"}><FileText /> Préparer le mémoire du lot {l.number}</SubmitButton>
                        </ActionForm>
                      ) : null;
                    })}
                    {analysis?.status !== "DONE" && canEdit && <p className="text-xs text-muted-foreground">Disponible après l&apos;analyse du DCE.</p>}
                  </div>
                ) : proposalFor(null) ? (
                  <Link href={`/proposals/${proposalFor(null)}`} className={buttonVariants({ variant: "secondary" }) + " w-full"}><FileText /> Ouvrir le mémoire technique</Link>
                ) : canEdit ? (
                  <ActionForm action={createProposalAction}>
                    <input type="hidden" name="tenderId" value={tender.id} />
                    <SubmitButton className="w-full" disabled={analysis?.status !== "DONE"}><FileText /> Préparer le mémoire technique</SubmitButton>
                    {analysis?.status !== "DONE" && <p className="mt-1 text-xs text-muted-foreground">Disponible après l&apos;analyse du DCE.</p>}
                  </ActionForm>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">Le dépôt sur la plateforme de l&apos;acheteur reste manuel.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Commentaires ({tender.comments.length})</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {tender.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">{c.author.name} · {formatDateTime(c.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-line">{c.body}</p>
                </div>
              ))}
              {canEdit && (
                <ActionForm action={addCommentAction} resetOnSuccess className="flex flex-col gap-2">
                  <input type="hidden" name="tenderId" value={tender.id} />
                  <Textarea name="body" placeholder="Ajouter un commentaire…" className="min-h-16" required />
                  <SubmitButton size="sm" variant="outline">Publier</SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent>
              {history.length === 0 ? <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p> : (
                <ul className="flex flex-col gap-1.5 text-xs">
                  {history.map((h) => (
                    <li key={h.id}><span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span> — {h.user?.name ?? "Système"} : {h.action}{h.action === "tender.status_changed" ? ` (${fr.tenderStatus[(h.metadata as { to: keyof typeof fr.tenderStatus }).to]})` : ""}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
