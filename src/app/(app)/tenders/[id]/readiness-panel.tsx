import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CheckLevel, Readiness } from "@/server/applications/readiness";

const ICON = { ok: CheckCircle2, warning: AlertTriangle, blocker: XCircle } as const;
const TONE = { ok: "text-success", warning: "text-warning", blocker: "text-danger" } as const;
/** Où corriger chaque point. */
const FIX: Record<string, { href: (tenderId: string) => string; label: string }> = {
  validity: { href: () => "/company#pieces", label: "Profil entreprise" },
  pricing: { href: (id) => `/tenders/${id}#chiffrage`, label: "Chiffrage" },
  pieces: { href: (id) => `/tenders/${id}#dossier`, label: "Dossier" },
  files: { href: (id) => `/tenders/${id}#dossier`, label: "Dossier" },
  lots: { href: (id) => `/tenders/${id}#dossier`, label: "Lots" },
};

export function ReadinessPanel({ tenderId, readiness }: { tenderId: string; readiness: Readiness }) {
  const { ready, blockers, warnings, checks } = readiness;
  const order: CheckLevel[] = ["blocker", "warning", "ok"];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Contrôle avant dépôt</CardTitle>
          {ready ? <Badge tone="success">Prêt à déposer</Badge> : <Badge tone="danger">{blockers} point(s) bloquant(s)</Badge>}
        </div>
        <CardDescription>
          {ready
            ? warnings ? `Aucun point bloquant ; ${warnings} point(s) à vérifier.` : "Dossier complet et recevable au regard des contrôles de l'application."
            : "Le passage à « Prête à déposer » ou « Déposée » est bloqué tant que ces points ne sont pas traités."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {sorted.map((c) => {
            const Icon = ICON[c.level];
            const fix = c.level !== "ok" ? FIX[c.key] : undefined;
            return (
              <li key={c.key} className="flex gap-2">
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[c.level])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{c.label}</span>
                    <span className="sr-only"> — {c.level === "ok" ? "conforme" : c.level === "warning" ? "à vérifier" : "bloquant"}</span>
                    {" : "}
                    <span className={cn(c.level === "ok" && "text-muted-foreground")}>{c.summary}</span>
                    {fix && <> <Link href={fix.href(tenderId)} className="text-xs text-primary hover:underline">{fix.label}</Link></>}
                  </p>
                  {c.details.length > 0 && (
                    <details className="mt-0.5 text-xs text-muted-foreground" open={c.level === "blocker" && c.details.length <= 5}>
                      <summary className="cursor-pointer select-none">{c.details.length} détail(s)</summary>
                      <ul className="mt-1 list-disc pl-4">{c.details.map((d) => <li key={d}>{d}</li>)}</ul>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
