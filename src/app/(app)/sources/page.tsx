import { ExternalLink, RefreshCw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { parseSort, SortTh, sortRows } from "@/components/sortable";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Table, Td } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { requireContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/rbac";
import { ALL_SOURCES, SOURCE_META } from "@/server/connectors/registry";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { saveSourceAction, syncNowAction } from "./actions";

export const metadata = { title: "Sources et automatisations" };

const STATUS_TONE = { SUCCESS: "success", PARTIAL: "warning", FAILED: "danger", RUNNING: "primary" } as const;
const STATUS_LABEL = { SUCCESS: "Réussie", PARTIAL: "Partielle", FAILED: "Échec", RUNNING: "En cours" } as const;

const RUN_SORT = ["started", "source", "trigger", "status", "fetched", "created", "updated", "duplicates", "errors"] as const;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const runSort = parseSort(sp, RUN_SORT, { key: "started", dir: "desc" });
  const [configs, runRows] = await Promise.all([
    prisma.sourceConfig.findMany({ where: { organizationId: ctx.orgId } }),
    prisma.syncRun.findMany({ where: { organizationId: ctx.orgId }, orderBy: { startedAt: "desc" }, take: 30 }),
  ]);
  // Tri des 30 dernières synchronisations.
  const runs = sortRows(runRows, runSort, {
    started: (r) => r.startedAt,
    source: (r) => r.source,
    trigger: (r) => r.trigger,
    status: (r) => STATUS_LABEL[r.status],
    fetched: (r) => r.fetched,
    created: (r) => r.created,
    updated: (r) => r.updated,
    duplicates: (r) => r.duplicates,
    errors: (r) => ((r.errors as unknown[] | null) ?? []).length,
  });
  const isAdmin = hasRole(ctx.role, "ADMIN");

  return (
    <>
      <PageHeader
        title="Sources et automatisations"
        description={`Synchronisation automatique selon la planification « ${env().SYNC_CRON} » (fuseau Europe/Paris). Seules des API officielles et ouvertes sont utilisées.`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {ALL_SOURCES.map((key) => {
          const cfg = configs.find((c) => c.source === key);
          const settings = (cfg?.settings ?? {}) as { daysBack?: number; maxNotices?: number };
          const meta = SOURCE_META[key];
          return (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{meta.label}</CardTitle>
                  <Badge tone={cfg?.enabled === false ? "neutral" : "success"}>{cfg?.enabled === false ? "Désactivée" : "Active"}</Badge>
                </div>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="text-xs text-muted-foreground">
                  <p>{meta.licence}</p>
                  <a className="inline-flex items-center gap-1 text-primary hover:underline" href={meta.url} target="_blank" rel="noreferrer">
                    Documentation de l&apos;API <ExternalLink className="size-3" />
                  </a>
                  <p className="mt-1">
                    Dernière synchronisation : {cfg?.lastSyncAt ? formatDateTime(cfg.lastSyncAt) : "jamais"}
                    {cfg?.lastStatus && <> — {STATUS_LABEL[cfg.lastStatus]}</>}
                  </p>
                </div>
                <ActionForm action={saveSourceAction} className="grid grid-cols-2 gap-3">
                  <input type="hidden" name="source" value={key} />
                  <label className="col-span-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="enabled" defaultChecked={cfg?.enabled ?? true} disabled={!isAdmin} className="size-4" /> Source activée
                  </label>
                  <Field label="Profondeur initiale (jours)">
                    <Input name="daysBack" type="number" min={1} max={90} defaultValue={settings.daysBack ?? 14} disabled={!isAdmin} />
                  </Field>
                  <Field label="Avis max. par synchronisation">
                    <Input name="maxNotices" type="number" min={10} max={10000} defaultValue={settings.maxNotices ?? 2000} disabled={!isAdmin} />
                  </Field>
                  {isAdmin && <SubmitButton variant="outline" className="col-span-2 sm:col-span-1">Enregistrer</SubmitButton>}
                </ActionForm>
                {hasRole(ctx.role, "MEMBER") && (
                  <ActionForm action={syncNowAction}>
                    <input type="hidden" name="source" value={key} />
                    <SubmitButton disabled={cfg?.enabled === false} pendingText="Mise en file…">
                      <RefreshCw /> Synchroniser maintenant
                    </SubmitButton>
                  </ActionForm>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Historique des synchronisations</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState title="Aucune synchronisation">Lancez une synchronisation ci-dessus (le worker doit être démarré).</EmptyState>
          ) : (
            <Table>
              <thead className="border-b">
                <tr>
                  <SortTh label="Début" column="started" sort={runSort} params={sp} firstDir="desc" />
                  <SortTh label="Source" column="source" sort={runSort} params={sp} />
                  <SortTh label="Déclencheur" column="trigger" sort={runSort} params={sp} />
                  <SortTh label="Statut" column="status" sort={runSort} params={sp} />
                  <SortTh label="Reçus" column="fetched" sort={runSort} params={sp} firstDir="desc" className="text-right" />
                  <SortTh label="Créés" column="created" sort={runSort} params={sp} firstDir="desc" className="text-right" />
                  <SortTh label="Mis à jour" column="updated" sort={runSort} params={sp} firstDir="desc" className="text-right" />
                  <SortTh label="Doublons" column="duplicates" sort={runSort} params={sp} firstDir="desc" className="text-right" />
                  <SortTh label="Erreurs" column="errors" sort={runSort} params={sp} firstDir="desc" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => {
                  const errors = (r.errors as Array<{ message: string }>) ?? [];
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</Td>
                      <Td>{r.source}</Td>
                      <Td>{r.trigger === "cron" ? "Planifié" : "Manuel"}</Td>
                      <Td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></Td>
                      <Td className="text-right tabular-nums">{r.fetched}</Td>
                      <Td className="text-right tabular-nums">{r.created}</Td>
                      <Td className="text-right tabular-nums">{r.updated}</Td>
                      <Td className="text-right tabular-nums">{r.duplicates}</Td>
                      <Td className="max-w-xs truncate text-xs text-danger" title={errors.map((e) => e.message).join("\n")}>{errors[0]?.message ?? ""}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
