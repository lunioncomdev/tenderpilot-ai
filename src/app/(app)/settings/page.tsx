import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { aiStatus, monthlySpendUsd, PLAN_LIMITS } from "@/server/ai/gateway";
import { requireContext } from "@/server/auth/context";
import { hasRole, ROLE_LABELS } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { CRITERIA, resolveWeights } from "@/server/scoring/engine";
import { addMemberAction, saveWeightsAction } from "./actions";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const [org, profile, members, usage, spend] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } }),
    prisma.membership.findMany({ where: { organizationId: ctx.orgId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.aiUsageLog.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 25 }),
    monthlySpendUsd(ctx.orgId),
  ]);
  const raw = (profile?.scoringWeights ?? {}) as Record<string, number>;
  const effective = resolveWeights(profile?.scoringWeights);
  const isAdmin = hasRole(ctx.role, "ADMIN");
  const ai = aiStatus();
  const limits = PLAN_LIMITS[org.plan];

  return (
    <>
      <PageHeader title="Paramètres" description={`Organisation « ${org.name} » — offre ${org.plan} (facturation non activée).`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pondération du scoring</CardTitle>
            <CardDescription>Les valeurs sont normalisées à 100. Les critères éliminatoires restent évalués à part et prévalent toujours.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveWeightsAction} className="grid grid-cols-2 gap-3">
              {CRITERIA.map((c) => (
                <Field key={c.key} label={c.label} hint={`Effectif : ${effective[c.key].toFixed(1)} pts`}>
                  <Input name={c.key} type="number" min={0} max={100} step={1} defaultValue={raw[c.key] ?? c.defaultWeight} disabled={!isAdmin} />
                </Field>
              ))}
              {isAdmin && <div className="col-span-2"><SubmitButton>Enregistrer</SubmitButton></div>}
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intelligence artificielle</CardTitle>
            <CardDescription>Fournisseur : Anthropic (Claude). Les appels sont déclenchés manuellement, jamais à la détection.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Alert tone={ai.enabled ? "success" : "warning"}>{ai.enabled ? `Active — modèle ${ai.model}, effort ${env().AI_EFFORT}.` : `Inactive : ${ai.reason}.`}</Alert>
            <p>Dépense estimée ce mois : <strong>{spend.toFixed(2)} USD</strong> / budget {env().AI_MONTHLY_BUDGET_USD} USD.</p>
            <p className="text-muted-foreground">Quotas de l&apos;offre : {limits.analysesPerMonth} analyses et {limits.sectionsPerMonth} sections par mois, {limits.maxUsers} utilisateurs.</p>
            <Table>
              <thead className="border-b"><tr><Th>Date</Th><Th>Opération</Th><Th className="text-right">Tokens in/out</Th><Th className="text-right">Coût</Th><Th>État</Th></tr></thead>
              <tbody className="divide-y">
                {usage.map((u) => (
                  <tr key={u.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(u.createdAt)}</Td>
                    <Td className="text-xs">{u.operation}</Td>
                    <Td className="text-right text-xs tabular-nums">{(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens).toLocaleString("fr-FR")} / {u.outputTokens.toLocaleString("fr-FR")}</Td>
                    <Td className="text-right text-xs tabular-nums">{Number(u.costUsd).toFixed(3)} $</Td>
                    <Td>{u.success ? <Badge tone="success">OK</Badge> : <Badge tone="danger" title={u.error ?? ""}>Échec</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {usage.length === 0 && <p className="text-xs text-muted-foreground">Aucun appel IA enregistré.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Utilisateurs</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <thead className="border-b"><tr><Th>Nom</Th><Th>E-mail</Th><Th>Rôle</Th><Th>Dernière connexion</Th></tr></thead>
              <tbody className="divide-y">
                {members.map((m) => (
                  <tr key={m.id}><Td>{m.user.name}</Td><Td>{m.user.email}</Td><Td>{ROLE_LABELS[m.role]}</Td><Td>{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "—"}</Td></tr>
                ))}
              </tbody>
            </Table>
            {isAdmin && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">Ajouter un collaborateur</summary>
                <ActionForm action={addMemberAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-4">
                  <Field label="Nom"><Input name="name" required /></Field>
                  <Field label="E-mail"><Input name="email" type="email" required /></Field>
                  <Field label="Rôle">
                    <Select name="role" defaultValue="MEMBER">
                      <option value="ADMIN">{ROLE_LABELS.ADMIN}</option><option value="MEMBER">{ROLE_LABELS.MEMBER}</option><option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
                    </Select>
                  </Field>
                  <Field label="Mot de passe initial"><Input name="password" type="password" required minLength={12} autoComplete="new-password" /></Field>
                  <div className="md:col-span-4"><SubmitButton>Ajouter</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
