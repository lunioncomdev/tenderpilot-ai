import { Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Textarea } from "@/components/ui/primitives";
import { formatEur } from "@/lib/utils";
import { requireContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { addReferenceAction, deleteReferenceAction, savePrivacyAction, saveProfileAction } from "./actions";

export const metadata = { title: "Profil entreprise" };

function Check({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

export default async function CompanyPage() {
  const ctx = await requireContext();
  const [p, refs] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } }),
    prisma.companyReference.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ year: "desc" }, { createdAt: "desc" }] }),
  ]);
  const canEdit = hasRole(ctx.role, "ADMIN");
  const join = (a?: string[]) => (a ?? []).join(", ");

  return (
    <>
      <PageHeader
        title="Profil entreprise"
        description="Ces données alimentent le scoring et le mémoire technique. L'IA ne peut rien affirmer sur l'entreprise qui ne figure pas ici."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Identité, capacités et cibles</CardTitle>
              <CardDescription>Listes : une valeur par ligne ou séparées par des virgules.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveProfileAction} className="grid gap-4 md:grid-cols-2">
                <fieldset disabled={!canEdit} className="contents">
                  <Field label="Raison sociale"><Input name="legalName" defaultValue={p?.legalName ?? ctx.orgName} required /></Field>
                  <Field label="SIREN / SIRET"><Input name="siren" defaultValue={p?.siren ?? ""} inputMode="numeric" /></Field>
                  <Field label="Pays d'établissement" hint="Code ISO, ex. FR"><Input name="country" defaultValue={p?.country ?? "FR"} maxLength={2} /></Field>
                  <Field label="Zones de candidature autorisées" hint="Codes pays ISO, ex. FR, BE, LU"><Input name="eligibleCountries" defaultValue={join(p?.eligibleCountries)} /></Field>
                  <Field label="Présentation" className="md:col-span-2"><Textarea name="description" defaultValue={p?.description ?? ""} /></Field>
                  <Field label="Compétences"><Textarea name="skills" defaultValue={join(p?.skills)} placeholder="Développement web, Applications métiers, IA…" /></Field>
                  <Field label="Technologies"><Textarea name="technologies" defaultValue={join(p?.technologies)} placeholder="Laravel, Symfony, Next.js, React, Node.js…" /></Field>
                  <Field label="Certifications détenues" hint="Uniquement celles réellement obtenues."><Textarea name="certifications" defaultValue={join(p?.certifications)} /></Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Effectif"><Input name="headcount" type="number" min={0} defaultValue={p?.headcount ?? ""} /></Field>
                    <Field label="CA annuel (€)"><Input name="annualRevenueEur" type="number" min={0} defaultValue={p?.annualRevenueEur ?? ""} /></Field>
                    <Field label="Budget cible min (€)"><Input name="minBudgetEur" type="number" min={0} defaultValue={p?.minBudgetEur ?? ""} /></Field>
                    <Field label="Budget cible max (€)"><Input name="maxBudgetEur" type="number" min={0} defaultValue={p?.maxBudgetEur ?? ""} /></Field>
                  </div>
                  <Field label="Codes CPV de veille" hint="8 chiffres ; préfixes acceptés par TED (72000000 = tout le 72…)"><Textarea name="cpvCodes" defaultValue={join(p?.cpvCodes)} /></Field>
                  <Field label="Mots-clés de veille"><Textarea name="keywords" defaultValue={join(p?.keywords)} /></Field>
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <Check name="canSubcontract" label="Peut sous-traiter" defaultChecked={p?.canSubcontract ?? true} />
                    <Check name="canJoinConsortium" label="Peut candidater en groupement" defaultChecked={p?.canJoinConsortium ?? true} />
                    <Check name="insuranceRc" label="Assurance RC professionnelle en cours" defaultChecked={p?.insuranceRc ?? false} />
                  </div>
                  <Field label="Méthodologie projet" className="md:col-span-2"><Textarea name="methodology" defaultValue={p?.methodology ?? ""} /></Field>
                  <Field label="Processus qualité"><Textarea name="qualityProcess" defaultValue={p?.qualityProcess ?? ""} /></Field>
                  <Field label="Politique de sécurité / PCA-PRA"><Textarea name="securityPolicy" defaultValue={p?.securityPolicy ?? ""} /></Field>
                  <Field label="Engagements RGPD"><Textarea name="gdprCommitments" defaultValue={p?.gdprCommitments ?? ""} /></Field>
                  <Field label="Éco-conception"><Textarea name="ecoDesign" defaultValue={p?.ecoDesign ?? ""} /></Field>
                  <Field label="Accessibilité (RGAA)" className="md:col-span-2"><Textarea name="accessibility" defaultValue={p?.accessibility ?? ""} /></Field>
                </fieldset>
                {canEdit && (
                  <div className="md:col-span-2">
                    <SubmitButton pendingText="Enregistrement…">Enregistrer le profil</SubmitButton>
                  </div>
                )}
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Références projets ({refs.length})</CardTitle>
              <CardDescription>Seules les références marquées « citables » peuvent apparaître dans un mémoire.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {refs.length === 0 ? (
                <EmptyState title="Aucune référence">Ajoutez vos projets réels : ils servent au scoring « Capacités et références » et au mémoire.</EmptyState>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {refs.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-4 p-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.title} <span className="font-normal text-muted-foreground">— {r.client}{r.year ? ` (${r.year})` : ""}</span>
                        </p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.amountEur !== null && <Badge>{formatEur(r.amountEur)}</Badge>}
                          {r.technologies.map((t) => <Badge key={t} tone="primary">{t}</Badge>)}
                          {!r.isPublic && <Badge tone="warning">Non citable</Badge>}
                        </div>
                      </div>
                      {canEdit && (
                        <ActionForm action={deleteReferenceAction} confirm="Supprimer cette référence ?">
                          <input type="hidden" name="id" value={r.id} />
                          <Button variant="ghost" size="icon" aria-label="Supprimer"><Trash2 /></Button>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {hasRole(ctx.role, "MEMBER") && (
                <details className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">Ajouter une référence</summary>
                  <ActionForm action={addReferenceAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-2">
                    <Field label="Intitulé du projet"><Input name="title" required /></Field>
                    <Field label="Client"><Input name="client" required /></Field>
                    <Field label="Année"><Input name="year" type="number" min={1990} max={2100} /></Field>
                    <Field label="Montant (€)"><Input name="amountEur" type="number" min={0} /></Field>
                    <Field label="Durée (mois)"><Input name="durationMonths" type="number" min={0} /></Field>
                    <Field label="Secteur"><Input name="sector" /></Field>
                    <Field label="Description" className="md:col-span-2"><Textarea name="description" required /></Field>
                    <Field label="Technologies" className="md:col-span-2"><Input name="technologies" /></Field>
                    <Check name="isPublic" label="Citable dans un mémoire (accord du client)" defaultChecked />
                    <div className="md:col-span-2"><SubmitButton>Ajouter</SubmitButton></div>
                  </ActionForm>
                </details>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Confidentialité et IA</CardTitle>
              <CardDescription>Contrôle l&apos;envoi des documents de consultation au fournisseur d&apos;IA (Anthropic).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Alert tone={p?.allowAiDocumentUpload ? "success" : "warning"}>
                {p?.allowAiDocumentUpload
                  ? "Autorisé : les DCE importés et les données du profil peuvent être transmis à l'API Claude lors d'une analyse ou d'une génération déclenchée manuellement."
                  : "Désactivé : aucune analyse IA ni génération de mémoire n'est possible."}
              </Alert>
              <ActionForm action={savePrivacyAction} className="flex flex-col gap-3">
                <Check name="allowAiDocumentUpload" label="J'autorise l'envoi des DCE et du profil à l'IA" defaultChecked={p?.allowAiDocumentUpload ?? false} disabled={ctx.role !== "OWNER"} />
                {ctx.role === "OWNER" ? <SubmitButton variant="outline">Enregistrer</SubmitButton> : <p className="text-xs text-muted-foreground">Réservé au propriétaire.</p>}
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
