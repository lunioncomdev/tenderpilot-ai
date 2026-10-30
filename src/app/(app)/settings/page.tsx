import { ActionForm, SubmitButton } from "@/components/form";
import { parseSort, SortTh, sortRows } from "@/components/sortable";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, Td, Textarea } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { aiStatus, monthlySpendUsd, PLAN_LIMITS } from "@/server/ai/gateway";
import { AI_RULE_MAX_LENGTH, AI_RULE_OPS, parseAiRules } from "@/server/ai/rules";
import { requireContext } from "@/server/auth/context";
import { hasRole, ROLE_LABELS } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { CRITERIA, resolveWeights } from "@/server/scoring/engine";
import { addMemberAction, saveAiRulesAction, saveWeightsAction } from "./actions";

export const metadata = { title: "Paramètres" };

const USAGE_SORT = ["date", "operation", "tokens", "cost", "success"] as const;
const MEMBER_SORT = ["name", "email", "role", "login"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const usageSort = parseSort(sp, USAGE_SORT, { key: "date", dir: "desc" }, "u_");
  const memberSort = parseSort(sp, MEMBER_SORT, { key: "name", dir: "asc" }, "m_");
  const [org, profile, memberRows, usageRows, spend] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } }),
    prisma.membership.findMany({ where: { organizationId: ctx.orgId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.aiUsageLog.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 25 }),
    monthlySpendUsd(ctx.orgId),
  ]);
  // Tri des 25 derniers appels (la liste reste celle des plus récents).
  const usage = sortRows(usageRows, usageSort, {
    date: (u) => u.createdAt,
    operation: (u) => u.operation,
    tokens: (u) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens,
    cost: (u) => Number(u.costUsd),
    success: (u) => u.success,
  });
  const members = sortRows(memberRows, memberSort, {
    name: (m) => m.user.name,
    email: (m) => m.user.email,
    role: (m) => ROLE_LABELS[m.role],
    login: (m) => m.user.lastLoginAt,
  });
  const aiRules = parseAiRules(profile?.aiRules);
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
            <CardDescription>Fournisseur : Anthropic (Claude). Les nouveaux avis BOAMP sont analysés automatiquement après import de leur extrait ; les autres appels sont déclenchés manuellement.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Alert tone={ai.enabled ? "success" : "warning"}>{ai.enabled ? `Active — modèle ${ai.model}, effort ${env().AI_EFFORT}.` : `Inactive : ${ai.reason}.`}</Alert>
            <p>Dépense estimée ce mois : <strong>{spend.toFixed(2)} USD</strong> / budget {env().AI_MONTHLY_BUDGET_USD} USD.</p>
            <p className="text-muted-foreground">Quotas de l&apos;offre : {limits.analysesPerMonth} analyses et {limits.sectionsPerMonth} sections par mois, {limits.maxUsers} utilisateurs.</p>
            <Table>
              <thead className="border-b">
                <tr>
                  <SortTh label="Date" column="date" sort={usageSort} params={sp} prefix="u_" firstDir="desc" />
                  <SortTh label="Opération" column="operation" sort={usageSort} params={sp} prefix="u_" />
                  <SortTh label="Tokens in/out" column="tokens" sort={usageSort} params={sp} prefix="u_" firstDir="desc" className="text-right" />
                  <SortTh label="Coût" column="cost" sort={usageSort} params={sp} prefix="u_" firstDir="desc" className="text-right" />
                  <SortTh label="État" column="success" sort={usageSort} params={sp} prefix="u_" />
                </tr>
              </thead>
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
          <CardHeader>
            <CardTitle>Règles de traitement de l&apos;IA</CardTitle>
            <CardDescription>
              Consignes propres à votre agence, ajoutées au prompt de chaque traitement. Elles complètent les consignes de base sans les remplacer :
              les règles de sécurité et de véracité (documents tiers traités comme des données, sources citées, rien d&apos;inventé) restent prioritaires.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveAiRulesAction} className="flex flex-col gap-5">
              {AI_RULE_OPS.map((op) => (
                <div key={op.key} className="flex flex-col gap-2">
                  <Field label={op.label} hint={`${op.hint} (${AI_RULE_MAX_LENGTH} caractères max.)`}>
                    <Textarea name={op.key} rows={3} maxLength={AI_RULE_MAX_LENGTH} defaultValue={aiRules[op.key]} disabled={!isAdmin} />
                  </Field>
                  {op.base && (
                    <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Voir les consignes de base (non modifiables)</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans leading-relaxed">{op.base}</pre>
                    </details>
                  )}
                </div>
              ))}
              {isAdmin ? <SubmitButton className="self-start">Enregistrer les règles</SubmitButton> : <p className="text-xs text-muted-foreground">Seuls les administrateurs peuvent modifier ces règles.</p>}
            </ActionForm>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Utilisateurs</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <thead className="border-b">
                <tr>
                  <SortTh label="Nom" column="name" sort={memberSort} params={sp} prefix="m_" />
                  <SortTh label="E-mail" column="email" sort={memberSort} params={sp} prefix="m_" />
                  <SortTh label="Rôle" column="role" sort={memberSort} params={sp} prefix="m_" />
                  <SortTh label="Dernière connexion" column="login" sort={memberSort} params={sp} prefix="m_" firstDir="desc" />
                </tr>
              </thead>
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
