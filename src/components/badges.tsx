import type { NoticeState, Recommendation, TenderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { daysUntil } from "@/lib/utils";

export function StatusBadge({ status }: { status: TenderStatus }) {
  const tone =
    status === "GO" || status === "WON" ? "success" : status === "NO_GO" || status === "LOST" ? "danger" : status === "DETECTED" ? "neutral" : "primary";
  return <Badge tone={tone}>{fr.tenderStatus[status]}</Badge>;
}

export function RecommendationBadge({ value }: { value: Recommendation }) {
  return <Badge tone={value === "GO" ? "success" : value === "NO_GO" ? "danger" : "warning"}>{fr.recommendation[value]}</Badge>;
}

export function NoticeStateBadge({ state }: { state: NoticeState }) {
  if (state === "ACTIVE") return null;
  return <Badge tone={state === "MODIFIED" ? "warning" : "danger"}>{fr.noticeState[state]}</Badge>;
}

export function ScorePill({ score, label }: { score: number | null | undefined; label?: string }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = score >= 80 ? "bg-success text-white" : score >= 60 ? "bg-primary text-primary-foreground" : score >= 40 ? "bg-warning text-black" : "bg-muted text-muted-foreground";
  return (
    <span title={label} className={`inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums ${tone}`}>
      {score}
    </span>
  );
}

export function DeadlineBadge({ deadline }: { deadline: Date | null }) {
  const d = daysUntil(deadline);
  if (d === null) return <span className="text-xs text-muted-foreground">Non précisé</span>;
  if (d < 0) return <Badge tone="neutral">Clôturé</Badge>;
  return <Badge tone={d <= 7 ? "danger" : d <= 14 ? "warning" : "neutral"}>J-{d}</Badge>;
}
