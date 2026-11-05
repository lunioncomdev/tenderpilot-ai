import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Download, History, Sparkles, Upload } from "lucide-react";
import { AutoRefresh } from "@/components/client-utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { Markdown } from "@/components/markdown";
import { parseSort, SortTh, sortRows } from "@/components/sortable";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { formatDateTime } from "@/lib/utils";
import { aiStatus } from "@/server/ai/gateway";
import type { VerifiedSourceRef } from "@/server/analysis/schema";
import { requireContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { Sources } from "../../tenders/[id]/analysis-view";
import { PieceFileUpload, PieceFiles } from "../../tenders/[id]/application-pieces";
import {
  generateComplianceAction, generateEverythingAction, generateSectionAction, restoreVersionAction, saveComplianceAction, saveSectionAction,
  setProposalStatusAction, validateSectionAction,
} from "../actions";
import { SectionEditor } from "./section-editor";

const TONE = { PENDING: "neutral", GENERATING: "primary", AI_DRAFT: "warning", EDITED: "primary", VALIDATED: "success", FAILED: "danger" } as const;

const COMPLIANCE_SORT = ["order", "requirement", "status", "source"] as const;
const COMPLIANCE_STATUS_ORDER = Object.keys(fr.complianceStatus);

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const complianceSort = parseSort(sp, COMPLIANCE_SORT, { key: "order", dir: "asc" });
  const ctx = await requireContext();
  const proposal = await prisma.proposal.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      tender: { select: { id: true, title: true, buyerName: true } },
      sections: { orderBy: { order: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 10 } } },
      compliance: { orderBy: { order: "asc" } },
    },
  });
  if (!proposal) notFound();
  // Pièce « Mémoire technique » du dossier : un fichier joint y remplace le mémoire généré.
  const memoirePiece = await prisma.applicationPiece.findFirst({
    where: { organizationId: ctx.orgId, tenderId: proposal.tender.id, key: "memoire", lotId: proposal.lotId },
    select: { id: true, label: true, files: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, sizeBytes: true } } },
  });
  const uploaded = memoirePiece?.files ?? [];
  const canEdit = hasRole(ctx.role, "MEMBER");
  const ai = await aiStatus(ctx.orgId);
  const sectionsGenerating = proposal.sections.filter((s) => s.status === "GENERATING").length;
  const matrixGenerating = !!proposal.complianceGeneratingAt;
  const generating = sectionsGenerating > 0 || matrixGenerating;
  const validated = proposal.sections.filter((s) => s.status === "VALIDATED").length;
  const pending = proposal.sections.filter((s) => s.status === "PENDING" || s.status === "FAILED").length;
  const drafts = proposal.sections.filter((s) => s.status === "AI_DRAFT" || s.status === "EDITED").length;
  const matrixEmpty = proposal.compliance.filter((c) => !c.response.trim()).length;

  return (
    <>
      <AutoRefresh active={generating} intervalMs={5000} />
      <Link href={`/tenders/${proposal.tender.id}`} className="text-sm text-muted-foreground hover:underline">← {proposal.tender.title}</Link>
      <PageHeader
        title="Mémoire technique"
        description={`${validated}/${proposal.sections.length} sections validées. Toute affirmation non issue du profil entreprise est marquée [À VALIDER].`}
        actions={
          <>
            <a href={`/api/v1/proposals/${proposal.id}/export`} className={buttonVariants({ variant: "outline" })}><Download /> Export DOCX</a>
          </>
        }
      />
      {!ai.enabled && <Alert tone="warning" className="mb-4">IA indisponible : {ai.reason}. L&apos;édition manuelle reste possible, ou joignez votre propre mémoire.</Alert>}

      {uploaded.length > 0 ? (
        <Alert tone="success" className="mb-4">
          <p className="font-medium">Mémoire fourni sous forme de fichier</p>
          <p className="mt-1 text-sm">
            Le dossier de candidature et le contrôle avant dépôt utilisent {uploaded.length > 1 ? "les fichiers joints" : "le fichier joint"} ci-dessous à la place du mémoire rédigé ici.
            Retirez-{uploaded.length > 1 ? "les" : "le"} pour revenir au mémoire généré.
          </p>
          <PieceFiles files={uploaded} canEdit={canEdit} />
          {canEdit && memoirePiece && <div className="mt-2"><PieceFileUpload pieceId={memoirePiece.id} label={memoirePiece.label} maxMb={env().UPLOAD_MAX_MB} text="Ajouter un fichier" variant="outline" /></div>}
        </Alert>
      ) : canEdit && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <div>
              <p className="flex items-center gap-2 font-semibold"><Upload className="size-4 text-primary" /> Utiliser votre propre mémoire</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {memoirePiece
                  ? "Mémoire déjà rédigé ? Joignez-le (PDF ou DOCX) : il sera inclus dans le dossier à la place du mémoire généré par l'IA."
                  : "Générez la liste des pièces du dossier depuis la fiche de l'appel d'offres pour pouvoir joindre votre propre mémoire."}
              </p>
            </div>
            {memoirePiece && <div className="flex flex-wrap items-center gap-1"><PieceFileUpload pieceId={memoirePiece.id} label={memoirePiece.label} maxMb={env().UPLOAD_MAX_MB} text="Joindre mon mémoire" variant="outline" /></div>}
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card className="mb-6 border-primary/30 bg-accent/40">
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> Générer toutes les réponses par l&apos;IA</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pending} section(s) à rédiger · {drafts} brouillon(s) · {matrixEmpty}/{proposal.compliance.length} réponse(s) de la matrice vide(s).
                  Les sections validées ne sont jamais modifiées ; tout le contenu généré reste à relire et valider.
                </p>
              </div>
              {generating && (
                <Badge tone="primary">
                  En cours : {sectionsGenerating} section(s){matrixGenerating ? " + matrice" : ""}
                </Badge>
              )}
            </div>
            <ActionForm action={generateEverythingAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <SubmitButton disabled={!ai.enabled || generating} pendingText="Lancement…"><Sparkles /> Tout générer par l&apos;IA</SubmitButton>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="includeDrafts" className="size-4" /> Régénérer aussi les brouillons non validés et les réponses proposées par l&apos;IA
              </label>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm">Statut du mémoire :</span>
        {canEdit ? (
          <ActionForm action={setProposalStatusAction} className="flex items-center gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <Select name="status" defaultValue={proposal.status === "GENERATING" ? "DRAFT" : proposal.status} className="w-44">
              <option value="DRAFT">Brouillon</option><option value="IN_REVIEW">En relecture</option><option value="VALIDATED">Validé</option>
            </Select>
            <SubmitButton size="sm" variant="outline">Appliquer</SubmitButton>
          </ActionForm>
        ) : <Badge>{proposal.status}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav className="hidden lg:block">
          <ol className="sticky top-20 flex flex-col gap-1 text-sm">
            {proposal.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#s-${s.key}`} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                  <span className={`size-2 shrink-0 rounded-full ${s.status === "VALIDATED" ? "bg-success" : s.status === "PENDING" ? "bg-muted-foreground/40" : s.status === "FAILED" ? "bg-danger" : "bg-warning"}`} />
                  <span className="truncate">{i + 1}. {s.title}</span>
                </a>
              </li>
            ))}
            <li><a href="#conformite" className="block rounded px-2 py-1 font-medium hover:bg-muted">Matrice de conformité</a></li>
          </ol>
        </nav>

        <div className="flex flex-col gap-4">
          {proposal.sections.map((s, i) => {
            const src = (s.sources ?? {}) as { dce?: VerifiedSourceRef[]; references?: Array<{ title: string }> };
            return (
              <Card key={s.id} id={`s-${s.key}`} className="scroll-mt-20">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{i + 1}. {s.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[s.status]}>{fr.sectionStatus[s.status]}</Badge>
                      {s.version > 0 && <Badge tone="outline">v{s.version}</Badge>}
                    </div>
                  </div>
                  {s.guidance && <CardDescription className="whitespace-pre-line">{s.guidance}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {s.status === "FAILED" && <Alert tone="danger">Échec : {s.error}</Alert>}
                  {s.status === "GENERATING" ? (
                    <Alert>Génération en cours…</Alert>
                  ) : (
                    <SectionEditor sectionId={s.id} content={s.content} preview={<Markdown source={s.content} />} disabled={!canEdit} action={saveSectionAction} />
                  )}
                  {s.toValidate.length > 0 && (
                    <Alert tone="warning">
                      <p className="font-medium">À valider avant dépôt :</p>
                      <ul className="mt-1 list-disc pl-5">{s.toValidate.map((x, j) => <li key={j}>{x}</li>)}</ul>
                    </Alert>
                  )}
                  {(src.dce?.length || src.references?.length) ? (
                    <p className="text-xs text-muted-foreground">
                      {src.dce?.length ? <>Sources DCE : <Sources sources={src.dce} /> </> : null}
                      {src.references?.length ? <>· Références mobilisables : {src.references.map((r) => r.title).join(" ; ")}</> : null}
                    </p>
                  ) : null}
                  {canEdit && s.status !== "GENERATING" && (
                    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                      <ActionForm action={generateSectionAction} className="flex flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="sectionId" value={s.id} />
                        <Input name="instruction" placeholder="Consigne de régénération (optionnel)" className="h-8 min-w-48 flex-1" maxLength={1000} />
                        <SubmitButton size="sm" variant="outline" disabled={!ai.enabled}><Sparkles /> {s.content ? "Régénérer" : "Générer"}</SubmitButton>
                      </ActionForm>
                      {s.content && (
                        <ActionForm action={validateSectionAction}>
                          <input type="hidden" name="sectionId" value={s.id} />
                          <input type="hidden" name="validated" value={s.status === "VALIDATED" ? "0" : "1"} />
                          <SubmitButton size="sm" variant={s.status === "VALIDATED" ? "ghost" : "secondary"}>
                            <CheckCircle2 /> {s.status === "VALIDATED" ? "Retirer la validation" : "Valider"}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  )}
                  {s.versions.length > 1 && (
                    <details className="text-xs">
                      <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground"><History className="size-3" /> Historique ({s.versions.length} versions)</summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {s.versions.map((v) => (
                          <li key={v.id} className="flex items-center gap-2">
                            <span>v{v.version} · {formatDateTime(v.createdAt)} · {v.author.startsWith("ai:") ? `IA (${v.author.slice(3)})` : "manuel"}</span>
                            {canEdit && v.version !== s.version && (
                              <ActionForm action={restoreVersionAction}>
                                <input type="hidden" name="versionId" value={v.id} />
                                <button className="text-primary hover:underline">restaurer</button>
                              </ActionForm>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Card id="conformite" className="scroll-mt-20">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Matrice de conformité</CardTitle>
                {canEdit && proposal.compliance.length > 0 && (
                  <ActionForm action={generateComplianceAction} className="flex items-center gap-2">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="overwrite" /> remplacer les réponses IA</label>
                    <SubmitButton size="sm" variant="outline" disabled={!ai.enabled || matrixGenerating}><Sparkles /> Générer les réponses</SubmitButton>
                  </ActionForm>
                )}
              </div>
              <CardDescription>
                Exigences extraites du DCE. Les réponses marquées « IA » sont des propositions : modifiez-les et enregistrez pour les valider (elles ne seront plus remplacées).
              </CardDescription>
              {matrixGenerating && <Alert className="mt-2">Génération des réponses en cours…</Alert>}
              {proposal.complianceError && <Alert tone="danger" className="mt-2">Échec de la génération : {proposal.complianceError}</Alert>}
            </CardHeader>
            <CardContent>
              <Table>
                <thead className="border-b">
                  <tr>
                    <SortTh label="Exigence" column="requirement" sort={complianceSort} params={sp} />
                    <Th>Réponse proposée</Th>
                    <Th>Justificatif</Th>
                    <SortTh label="Statut" column="status" sort={complianceSort} params={sp} />
                    <SortTh label="Source" column="source" sort={complianceSort} params={sp} />
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortRows(proposal.compliance, complianceSort, {
                    order: (c) => c.order,
                    requirement: (c) => c.requirement,
                    status: (c) => COMPLIANCE_STATUS_ORDER.indexOf(c.status),
                    source: (c) => c.source,
                  }).map((c) => (
                    <tr key={c.id} className="align-top">
                      <Td className="max-w-xs">
                        {c.requirement}
                        {c.aiGenerated && <Badge tone="warning" className="ml-1.5">IA</Badge>}
                      </Td>
                      <Td colSpan={3} className="p-0">
                        <ActionForm action={saveComplianceAction} className="grid grid-cols-[1fr_1fr_9rem_auto] items-start gap-2 p-2">
                          <input type="hidden" name="itemId" value={c.id} />
                          <Input name="response" defaultValue={c.response} disabled={!canEdit} aria-label="Réponse" />
                          <Input name="evidence" defaultValue={c.evidence} disabled={!canEdit} aria-label="Justificatif" />
                          <Select name="status" defaultValue={c.status} disabled={!canEdit} aria-label="Statut">
                            {Object.entries(fr.complianceStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </Select>
                          {canEdit && <SubmitButton size="sm" variant="ghost">OK</SubmitButton>}
                        </ActionForm>
                      </Td>
                      <Td className="text-xs text-muted-foreground">{c.source}</Td>
                      <Td />
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
