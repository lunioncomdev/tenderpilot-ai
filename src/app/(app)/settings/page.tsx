import { ActionForm, SubmitButton } from "@/components/form";
import { parseSort, SortTh, sortRows } from "@/components/sortable";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { aiStatus, monthlySpendUsd, PLAN_LIMITS } from "@/server/ai/gateway";
import { AI_RULE_MAX_LENGTH, AI_RULE_OPS, parseAiRules } from "@/server/ai/rules";
import { requireContext } from "@/server/auth/context";
import { hasRole, ROLE_LABELS } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { CRITERIA, resolveWeights } from "@/server/scoring/engine";
import { KNOWN_PLATFORMS } from "@/server/dce/platforms";
import { settingsProblem } from "@/server/dce/retrieve-service";
import { addMemberAction, deletePlatformAccountAction, saveAiRulesAction, saveAiSettingsAction, saveDceSettingsAction, savePlatformAccountAction, saveWeightsAction } from "./actions";

export const metadata = { title: "Paramètres" };

const USAGE_SORT = ["date", "operation", "tokens", "cost", "success"] as const;
const MEMBER_SORT = ["name", "email", "role", "login"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const usageSort = parseSort(sp, USAGE_SORT, { key: "date", dir: "desc" }, "u_");
  const memberSort = parseSort(sp, MEMBER_SORT, { key: "name", dir: "asc" }, "m_");
  const [org, profile, memberRows, usageRows, spend, dce, accounts] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } }),
    prisma.membership.findMany({ where: { organizationId: ctx.orgId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.aiUsageLog.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 25 }),
    monthlySpendUsd(ctx.orgId),
    prisma.dceRetrievalSettings.findUnique({ where: { organizationId: ctx.orgId } }),
    prisma.platformAccount.findMany({ where: { organizationId: ctx.orgId }, orderBy: { host: "asc" }, select: { id: true, host: true, login: true, updatedAt: true } }),
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
  const ai = await aiStatus(ctx.orgId);
  const isOpenAi = env().AI_PROVIDER === "openai";
  const limits = PLAN_LIMITS[org.plan];
  const dceProblem = settingsProblem(dce);
  // Pré-remplissage depuis le profil entreprise et l'utilisateur courant.
  const [firstName, ...rest] = ctx.name.split(" ");
  const dv = {
    firstName: dce?.firstName || firstName || "", lastName: dce?.lastName || rest.join(" "), email: dce?.email || ctx.email,
    phone: dce?.phone ?? "", legalName: dce?.legalName || profile?.legalName || "", siret: dce?.siret || profile?.siren || "",
    address: dce?.address ?? "", address2: dce?.address2 ?? "", postalCode: dce?.postalCode ?? "", city: dce?.city ?? "",
  };

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
            <CardDescription>Fournisseur : {isOpenAi ? "OpenAI" : "Anthropic"}. Les nouveaux avis BOAMP sont analysés automatiquement après import de leur extrait ; les autres appels sont déclenchés manuellement.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Alert tone={ai.enabled ? "success" : "warning"}>{ai.enabled ? `Active — modèle ${ai.model}, effort ${env().AI_EFFORT}${ai.keySource === "organization" ? ", clé de l'organisation" : ai.keySource === "env" ? ", clé du serveur" : ""}.` : `Inactive : ${ai.reason}.`}</Alert>
            {isOpenAi && (
              <ActionForm action={saveAiSettingsAction} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <Field label="Modèle OpenAI" hint={`Vide : ${env().AI_MODEL} (AI_MODEL).`}>
                  <Input name="model" defaultValue={org.aiModel ?? ""} placeholder={env().AI_MODEL} list="openai-models" autoComplete="off" disabled={!isAdmin} />
                  <datalist id="openai-models">
                    {["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra", "gpt-5.5"].map((m) => <option key={m} value={m} />)}
                  </datalist>
                </Field>
                <Field
                  label="Clé API OpenAI"
                  hint={org.openaiApiKeyEnc ? "Clé enregistrée (chiffrée). Laisser vide pour la conserver." : env().OPENAI_API_KEY ? "Vide : clé OPENAI_API_KEY du serveur." : "Aucune clé configurée."}
                >
                  <Input name="apiKey" type="password" placeholder={org.openaiApiKeyEnc ? "••••••••••••" : "sk-…"} autoComplete="off" disabled={!isAdmin} />
                </Field>
                {org.openaiApiKeyEnc && isAdmin && (
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input type="checkbox" name="clearKey" className="size-4" /> Supprimer la clé enregistrée{env().OPENAI_API_KEY ? " (retour à OPENAI_API_KEY)" : ""}
                  </label>
                )}
                {isAdmin ? (
                  <div className="sm:col-span-2"><SubmitButton size="sm" pendingText="Vérification…">Enregistrer</SubmitButton></div>
                ) : (
                  <p className="text-xs text-muted-foreground sm:col-span-2">Seuls les administrateurs peuvent modifier ces paramètres.</p>
                )}
              </ActionForm>
            )}
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
          <CardHeader>
            <CardTitle>Récupération des DCE</CardTitle>
            <CardDescription>
              Les avis BOAMP ne contiennent pas le dossier de consultation : il est publié sur le profil acheteur, où son accès est gratuit, libre et direct
              (art. R2132-2 du code de la commande publique). Pour les plateformes Atexo (PLACE, Maximilien, Solaere, Mégalis…), l&apos;application
              télécharge le règlement de consultation et le DCE complet en remplissant le formulaire de retrait.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveDceSettingsAction} className="flex flex-col gap-4">
              <Alert tone={dceProblem ? "warning" : "success"}>
                {dceProblem ? `Retrait automatique inactif : ${dceProblem}.` : `Actif — mode ${dce?.mode === "IDENTIFIED" ? "identifié" : "anonyme"}${dce?.autoRetrieve ? ", retrait automatique des offres ouvertes" : ", à la demande depuis la fiche de l'offre"}.`}
              </Alert>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Mode de retrait" className="md:col-span-3" hint="Identifié : l'acheteur vous informera des modifications du DCE et des réponses aux questions des candidats.">
                  <Select name="mode" defaultValue={dce?.mode ?? "DISABLED"} disabled={!isAdmin}>
                    <option value="DISABLED">Désactivé</option>
                    <option value="IDENTIFIED">Identifié (recommandé)</option>
                    <option value="ANONYMOUS">Anonyme (aucune notification de l&apos;acheteur)</option>
                  </Select>
                </Field>
                <Field label="Prénom"><Input name="firstName" defaultValue={dv.firstName} disabled={!isAdmin} /></Field>
                <Field label="Nom"><Input name="lastName" defaultValue={dv.lastName} disabled={!isAdmin} /></Field>
                <Field label="E-mail de contact" hint="Reçoit les notifications des acheteurs."><Input name="email" type="email" defaultValue={dv.email} disabled={!isAdmin} /></Field>
                <Field label="Raison sociale"><Input name="legalName" defaultValue={dv.legalName} disabled={!isAdmin} /></Field>
                <Field label="SIRET (14 chiffres)"><Input name="siret" defaultValue={dv.siret} inputMode="numeric" maxLength={17} disabled={!isAdmin} /></Field>
                <Field label="Téléphone"><Input name="phone" type="tel" defaultValue={dv.phone} disabled={!isAdmin} /></Field>
                <Field label="Adresse" className="md:col-span-2"><Input name="address" defaultValue={dv.address} disabled={!isAdmin} /></Field>
                <Field label="Complément d'adresse"><Input name="address2" defaultValue={dv.address2} disabled={!isAdmin} /></Field>
                <Field label="Code postal"><Input name="postalCode" defaultValue={dv.postalCode} disabled={!isAdmin} /></Field>
                <Field label="Ville"><Input name="city" defaultValue={dv.city} disabled={!isAdmin} /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="acceptTerms" defaultChecked={!!dce?.termsAcceptedAt} disabled={!isAdmin} className="mt-0.5" />
                <span>
                  J&apos;accepte, au nom de la société, les conditions générales d&apos;utilisation des plateformes de dématérialisation sur lesquelles
                  l&apos;application retire les DCE (acceptation requise par le formulaire de retrait).
                  {dce?.termsAcceptedAt && <span className="text-muted-foreground"> Acceptées le {formatDateTime(dce.termsAcceptedAt)}.</span>}
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="autoRetrieve" defaultChecked={dce?.autoRetrieve ?? false} disabled={!isAdmin} className="mt-0.5" />
                <span>Retirer automatiquement le DCE des offres ouvertes : nouveaux avis à chaque synchronisation et rattrapage des offres existantes, puis analyse IA du dossier complet. Sinon, le retrait se lance depuis la fiche de l&apos;offre.</span>
              </label>
              {isAdmin ? <SubmitButton className="self-start">Enregistrer</SubmitButton> : <p className="text-xs text-muted-foreground">Seuls les administrateurs peuvent modifier ces paramètres.</p>}
            </ActionForm>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Comptes sur les plateformes acheteurs</CardTitle>
            <CardDescription>
              Identifiants de vos comptes entreprise (AWS-Achat, achatpublic, Klekoon…). Les mots de passe sont chiffrés (AES-256-GCM) et ne sont jamais réaffichés.
              Le retrait automatique sur ces plateformes n&apos;est pas encore pris en charge : le compte est rappelé sur la fiche de l&apos;offre.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {accounts.length > 0 ? (
              <Table>
                <thead className="border-b"><tr><Th>Plateforme</Th><Th>Identifiant</Th><Th>Mis à jour</Th><Th /></tr></thead>
                <tbody className="divide-y">
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <Td>{KNOWN_PLATFORMS.find((p) => p.host === a.host)?.name ?? a.host}<div className="text-xs text-muted-foreground">{a.host}</div></Td>
                      <Td>{a.login}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(a.updatedAt)}</Td>
                      <Td className="text-right">
                        {isAdmin && (
                          <ActionForm action={deletePlatformAccountAction} confirm={`Supprimer le compte ${a.host} ?`}>
                            <input type="hidden" name="id" value={a.id} />
                            <SubmitButton size="sm" variant="ghost">Supprimer</SubmitButton>
                          </ActionForm>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun compte enregistré.</p>
            )}
            {isAdmin && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">Ajouter ou modifier un compte</summary>
                <ActionForm action={savePlatformAccountAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-4">
                  <Field label="Plateforme (domaine)" hint="Choisissez ou saisissez le domaine.">
                    <Input name="host" list="platform-hosts" required placeholder="www.marches-publics.info" />
                    <datalist id="platform-hosts">
                      {KNOWN_PLATFORMS.map((p) => <option key={p.host} value={p.host}>{p.name}</option>)}
                    </datalist>
                  </Field>
                  <Field label="Identifiant"><Input name="login" required autoComplete="off" /></Field>
                  <Field label="Mot de passe" hint="Laisser vide pour conserver l'actuel."><Input name="password" type="password" autoComplete="new-password" /></Field>
                  <div className="flex items-end"><SubmitButton>Enregistrer</SubmitButton></div>
                </ActionForm>
              </details>
            )}
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
