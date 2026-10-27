import type { CompanyProfile, Prisma, PrismaClient, Tender } from "@prisma/client";
import { computeDedupKey } from "../connectors/dedup";
import type { NormalizedNotice } from "../connectors/types";
import { computePreScore } from "../scoring/prescore";

export type ApplyOutcome = "created" | "updated" | "duplicate" | "skipped";

type Db = PrismaClient | Prisma.TransactionClient;

function noticeFields(n: NormalizedNotice) {
  return {
    publicationRef: n.publicationRef,
    procedureId: n.procedureId,
    title: n.title,
    description: n.description,
    buyerName: n.buyerName,
    buyerCountry: n.buyerCountry,
    region: n.region,
    cpvCodes: n.cpvCodes,
    estimatedValue: n.estimatedValue,
    currency: n.currency,
    publishedAt: n.publishedAt,
    deadlineAt: n.deadlineAt,
    procedureType: n.procedureType,
    noticeType: n.noticeType,
    contractType: n.contractType,
    durationMonths: n.durationMonths,
    noticeUrl: n.noticeUrl,
    documentsUrl: n.documentsUrl,
    raw: n.raw as Prisma.InputJsonValue,
    dedupKey: computeDedupKey(n),
  };
}

/** Conserve les valeurs existantes quand le rectificatif ne les renseigne pas. */
function mergeCorrection(n: NormalizedNotice) {
  const f = noticeFields(n);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "raw" || k === "dedupKey" || k === "publicationRef") continue;
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out as Partial<ReturnType<typeof noticeFields>>;
}

async function findRelated(db: Db, orgId: string, n: NormalizedNotice): Promise<Tender | null> {
  if (n.relatedExternalIds.length) {
    const t = await db.tender.findFirst({
      where: { organizationId: orgId, origin: n.source, externalId: { in: n.relatedExternalIds } },
      orderBy: { createdAt: "asc" },
    });
    if (t) return t;
  }
  if (n.procedureId) {
    return db.tender.findFirst({
      where: { organizationId: orgId, procedureId: n.procedureId, duplicateOfId: null },
      orderBy: { createdAt: "asc" },
    });
  }
  return null;
}

async function findCanonical(db: Db, orgId: string, n: NormalizedNotice, dedupKey: string): Promise<Tender | null> {
  const or: Prisma.TenderWhereInput[] = [{ dedupKey }];
  if (n.procedureId) or.unshift({ procedureId: n.procedureId });
  return db.tender.findFirst({
    where: { organizationId: orgId, origin: { not: n.source }, duplicateOfId: null, OR: or },
    orderBy: { createdAt: "asc" },
  });
}

export async function applyNotice(
  db: Db,
  orgId: string,
  n: NormalizedNotice,
  profile: CompanyProfile | null,
  now = new Date(),
): Promise<ApplyOutcome> {
  if (n.kind === "PRIOR_INFO") return "skipped";

  if (n.kind === "CANCELLATION" || n.kind === "AWARD") {
    const related = await findRelated(db, orgId, n);
    if (!related) return "skipped";
    await db.tender.update({
      where: { id: related.id },
      data: { noticeState: n.kind === "CANCELLATION" ? "CANCELLED" : "AWARDED", sourceUpdatedAt: n.publishedAt ?? now },
    });
    return "updated";
  }

  if (n.kind === "CORRECTION") {
    const related = await findRelated(db, orgId, n);
    if (related && related.externalId !== n.externalId) {
      const patch = mergeCorrection(n);
      await db.tender.update({
        where: { id: related.id },
        data: {
          ...patch,
          noticeState: related.noticeState === "CANCELLED" ? "CANCELLED" : "MODIFIED",
          sourceUpdatedAt: n.publishedAt ?? now,
        },
      });
      return "updated";
    }
  }

  const fields = noticeFields(n);
  const existing = await db.tender.findUnique({
    where: { organizationId_origin_externalId: { organizationId: orgId, origin: n.source, externalId: n.externalId } },
  });

  if (existing) {
    const prevVersion = (existing.raw as { "notice-version"?: number } | null)?.["notice-version"];
    if (n.version !== null && typeof prevVersion === "number" && prevVersion >= n.version) return "skipped";
    await db.tender.update({
      where: { id: existing.id },
      data: {
        ...fields,
        preScore: computePreScore({ ...existing, ...fields }, profile, now).total,
        noticeState: existing.noticeState === "ACTIVE" && n.kind === "CORRECTION" ? "MODIFIED" : existing.noticeState,
        sourceUpdatedAt: n.publishedAt ?? now,
      },
    });
    return n.version !== null && typeof prevVersion === "number" ? "updated" : "skipped";
  }

  const canonical = await findCanonical(db, orgId, n, fields.dedupKey);
  await db.tender.create({
    data: {
      ...fields,
      organizationId: orgId,
      origin: n.source,
      externalId: n.externalId,
      duplicateOfId: canonical?.id ?? null,
      noticeState: n.kind === "CORRECTION" ? "MODIFIED" : "ACTIVE",
      preScore: computePreScore(fields, profile, now).total,
      sourceUpdatedAt: n.publishedAt ?? now,
    },
  });
  return canonical ? "duplicate" : "created";
}
