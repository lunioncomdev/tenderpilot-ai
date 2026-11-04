import { CheckCircle2, CircleAlert, ShieldAlert } from "lucide-react";
import { Alert, Badge } from "@/components/ui/primitives";
import { NOT_SPECIFIED } from "@/lib/utils";
import { FIELD_LABELS, LIST_LABELS, type TenderAnalysisResult, type VerifiedSourceRef } from "@/server/analysis/schema";

type Src = VerifiedSourceRef;

export function Sources({ sources }: { sources: Src[] }) {
  if (!sources?.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {sources.map((s, i) => (
        <span
          key={i}
          title={`« ${s.quote} »${s.verified ? "" : " — citation non retrouvée dans le document"}`}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${s.verified ? "border-success/30 text-success" : "border-warning/40 text-warning"}`}
        >
          {s.verified ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}
          {s.filename ?? s.chunkId}
          {s.pageStart ? ` p.${s.pageStart}${s.pageEnd && s.pageEnd !== s.pageStart ? `-${s.pageEnd}` : ""}` : ""}
        </span>
      ))}
    </span>
  );
}

const SEV = { high: { tone: "danger", label: "Élevé" }, medium: { tone: "warning", label: "Moyen" }, low: { tone: "neutral", label: "Faible" } } as const;

export function AnalysisView({ result, stats }: { result: TenderAnalysisResult; stats: { total: number; verified: number; excludedDocuments?: string[] } | null }) {
  const r = result as unknown as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-5 text-sm">
      {stats && (
        <p className="text-xs text-muted-foreground">
          {stats.verified}/{stats.total} citations vérifiées dans les documents.
          {stats.excludedDocuments?.length ? ` Documents non analysés (volume) : ${stats.excludedDocuments.join(", ")}.` : ""}
        </p>
      )}
      {result.injectionAttemptsDetected.length > 0 && (
        <Alert tone="warning">
          <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4" /> Contenu suspect détecté dans le DCE (ignoré par l&apos;IA)</p>
          <ul className="mt-1 list-disc pl-5">{result.injectionAttemptsDetected.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Alert>
      )}
      <p className="leading-relaxed">{result.summary}</p>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {FIELD_LABELS.map(([key, label]) => {
          const f = r[key] as { value: string | null; sources: Src[] };
          return (
            <div key={key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className={f.value ? "" : "text-muted-foreground italic"}>
                {f.value ?? NOT_SPECIFIED}
                <Sources sources={f.sources} />
              </dd>
            </div>
          );
        })}
      </dl>

      <div>
        <h4 className="mb-2 font-semibold">Critères de notation</h4>
        {result.awardCriteria.length === 0 ? (
          <p className="italic text-muted-foreground">{NOT_SPECIFIED}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {result.awardCriteria.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <Badge tone="primary">{c.weightPercent !== null ? `${c.weightPercent} %` : "pondération n.p."}</Badge>
                <span className="font-medium">{c.criterion}</span>
                {c.subCriteria.length > 0 && <span className="text-muted-foreground">— {c.subCriteria.join(" ; ")}</span>}
                <Sources sources={c.sources as Src[]} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {LIST_LABELS.map(([key, label]) => {
        const items = r[key] as Array<{ text: string; sources: Src[] }>;
        return (
          <div key={key}>
            <h4 className="mb-2 font-semibold">{label}</h4>
            {items.length === 0 ? (
              <p className="italic text-muted-foreground">{NOT_SPECIFIED}</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {items.map((it, i) => <li key={i}>{it.text}<Sources sources={it.sources} /></li>)}
              </ul>
            )}
          </div>
        );
      })}

      <div>
        <h4 className="mb-2 font-semibold">Risques contractuels</h4>
        {result.risks.length === 0 ? (
          <p className="italic text-muted-foreground">Aucun risque identifié</p>
        ) : (
          <ul className="space-y-1.5">
            {result.risks.map((x, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <Badge tone={SEV[x.severity].tone}>{SEV[x.severity].label}</Badge>
                {x.text}
                <Sources sources={x.sources as Src[]} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge>Visite obligatoire : {result.siteVisitMandatory === null ? NOT_SPECIFIED : result.siteVisitMandatory ? "oui" : "non"}</Badge>
        <Badge>Groupement : {result.consortiumAllowed === null ? NOT_SPECIFIED : result.consortiumAllowed ? "autorisé" : "non autorisé"}</Badge>
        <Badge>Sous-traitance : {result.subcontractingAllowed === null ? NOT_SPECIFIED : result.subcontractingAllowed ? "autorisée" : "non autorisée"}</Badge>
        {result.technologies?.length > 0 && <Badge tone="primary">Technologies : {result.technologies.join(", ")}</Badge>}
        {result.requiredSkills.length > 0 && <Badge tone="primary">Compétences : {result.requiredSkills.join(", ")}</Badge>}
      </div>
    </div>
  );
}
