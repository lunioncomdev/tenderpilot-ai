import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Download, History, Sparkles } from "lucide-react";
import { AutoRefresh } from "@/components/client-utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { formatDateTime } from "@/lib/utils";
import { aiStatus } from "@/server/ai/gateway";
import type { VerifiedSourceRef } from "@/server/analysis/schema";
import { requireContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { Sources } from "../../tenders/[id]/analysis-view";
import {
  generateAllAction, generateSectionAction, restoreVersionAction, saveComplianceAction, saveSectionAction,
  setProposalStatusAction, validateSectionAction,
} from "../actions";
import { SectionEditor } from "./section-editor";

const TONE = { PENDING: "neutral", GENERATING: "primary", AI_DRAFT: "warning", EDITED: "primary", VALIDATED: "success", FAILED: "danger" } as const;

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const canEdit = hasRole(ctx.role, "MEMBER");
  const ai = aiStatus();
  const generating = proposal.sections.some((s) => s.status === "GENERATING");
  const validated = proposal.sections.filter((s) => s.status === "VALIDATED").length;
  const pending = proposal.sections.filter((s) => s.status === "PENDING" || s.status === "FAILED").length;

  return (
    <>
      <AutoRefresh active={generating} intervalMs={5000} />
      <Link href={`/tenders/${proposal.tender.id}`} className="text-sm text-muted-foreground hover:underline">← {proposal.tender.title}</Link>
      <PageHeader
        title="Mémoire technique"
        description={`${validated}/${proposal.sections.length} sections validées. Toute affirmation non issue du profil entreprise est marquée [À VALIDER].`}
        actions={
          <>
            {canEdit && pending > 0 && (
              <ActionForm action={generateAllAction}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <SubmitButton disabled={!ai.enabled || generating} pendingText="Lancement…"><Sparkles /> Générer les {pending} sections restantes</SubmitButton>
              </ActionForm>
            )}
            <a href={`/api/v1/proposals/${proposal.id}/export`} className={buttonVariants({ variant: "outline" })}><Download /> Export DOCX</a>
          </>
        }
      />
      {!ai.enabled && <Alert tone="warning" className="mb-4">IA indisponible : {ai.reason}. L&apos;édition manuelle reste possible.</Alert>}

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
              <CardTitle>Matrice de conformité</CardTitle>
              <CardDescription>Générée depuis les critères, exigences et pièces extraits du DCE. À compléter et valider.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <thead className="border-b"><tr><Th>Exigence</Th><Th>Réponse proposée</Th><Th>Justificatif</Th><Th>Statut</Th><Th>Source</Th><Th /></tr></thead>
                <tbody className="divide-y">
                  {proposal.compliance.map((c) => (
                    <tr key={c.id} className="align-top">
                      <Td className="max-w-xs">{c.requirement}</Td>
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
