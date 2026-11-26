import type { DceRetrievalSettings } from "@prisma/client";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import { registerDocument, processDocument } from "../documents/document-service";
import { env } from "../env";
import { logger } from "../logger";
import { retrieveAtexo, type Identity } from "./atexo";
import { PlatformError, PlatformSession } from "./http";
import { detectPlatform } from "./platforms";

/**
 * Retrait, à la demande, du DCE d'un appel d'offres sur le profil acheteur, selon
 * les paramètres de l'organisation (mode, coordonnées, acceptation des CGU).
 */

export class DceRetrievalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DceRetrievalUnavailableError";
  }
}

/** Raison pour laquelle le retrait automatique est impossible, ou null s'il est possible. */
export function settingsProblem(s: DceRetrievalSettings | null): string | null {
  if (!s || s.mode === "DISABLED") return "retrait automatique désactivé (Paramètres → Récupération des DCE)";
  if (!s.termsAcceptedAt) return "acceptation des CGU des plateformes non donnée (Paramètres → Récupération des DCE)";
  if (s.mode === "IDENTIFIED") {
    const missing = (
      [["lastName", "nom"], ["firstName", "prénom"], ["email", "e-mail"], ["legalName", "raison sociale"], ["siret", "SIRET"], ["phone", "téléphone"], ["postalCode", "code postal"], ["city", "ville"]] as const
    ).filter(([k]) => !s[k].trim()).map(([, l]) => l);
    if (missing.length) return `coordonnées de retrait incomplètes : ${missing.join(", ")}`;
  }
  return null;
}

export function identityOf(s: DceRetrievalSettings): Identity {
  return {
    mode: s.mode === "IDENTIFIED" ? "IDENTIFIED" : "ANONYMOUS",
    firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, legalName: s.legalName,
    siret: s.siret, address: s.address, address2: s.address2, postalCode: s.postalCode, city: s.city,
  };
}

export type RetrievalOutcome = { imported: string[]; duplicates: string[]; warnings: string[] };

export async function retrieveDce(orgId: string, tenderId: string, userId: string | null, fetchImpl?: typeof fetch): Promise<RetrievalOutcome> {
  const [tender, settings] = await Promise.all([
    prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId }, select: { id: true, documentsUrl: true } }),
    prisma.dceRetrievalSettings.findUnique({ where: { organizationId: orgId } }),
  ]);
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");

  const fail = async (message: string): Promise<never> => {
    await prisma.tender.update({ where: { id: tenderId }, data: { dceFetchError: message.slice(0, 500) } });
    throw new DceRetrievalUnavailableError(message);
  };

  const problem = settingsProblem(settings);
  if (problem) return fail(`Retrait impossible : ${problem}`);
  const platform = detectPlatform(tender.documentsUrl);
  if (platform.kind === "none") return fail("Aucun lien vers le dossier de consultation dans l'avis");
  if (platform.kind === "account") {
    const account = await prisma.platformAccount.findUnique({ where: { organizationId_host: { organizationId: orgId, host: platform.host } } });
    return fail(
      account
        ? `${platform.name} : retrait automatique pas encore pris en charge ; connectez-vous avec le compte enregistré (${account.login}) puis importez le DCE`
        : `${platform.name} : plateforme à compte, retrait automatique pas encore pris en charge ; enregistrez votre compte dans Paramètres et importez le DCE`,
    );
  }
  if (platform.kind === "generic") return fail(`${platform.name} : plateforme non reconnue (lien générique ou logiciel non pris en charge)`);

  const session = new PlatformSession(platform.host, { maxBytes: env().DCE_MAX_MB * 1024 * 1024, fetchImpl });
  let result;
  try {
    result = await retrieveAtexo(session, platform.ref, identityOf(settings!));
  } catch (err) {
    if (err instanceof PlatformError) return fail(`${platform.name} : ${err.message}`);
    throw err;
  }

  const outcome: RetrievalOutcome = { imported: [], duplicates: [], warnings: [...result.warnings] };
  for (const f of result.files) {
    try {
      const { document, duplicate } = await registerDocument({ orgId, tenderId, filename: f.filename, data: f.data, userId, maxMb: env().DCE_MAX_MB });
      if (duplicate) {
        outcome.duplicates.push(document.filename);
        continue;
      }
      if (f.kind === "RC") await prisma.tenderDocument.update({ where: { id: document.id }, data: { kind: "RC" } });
      await processDocument(orgId, document.id);
      outcome.imported.push(document.filename);
    } catch (err) {
      outcome.warnings.push(`${f.filename} : ${(err as Error).message}`);
    }
  }

  const gotDce = result.files.some((f) => f.kind === "DCE");
  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      dceFetchedAt: outcome.imported.length || outcome.duplicates.length ? new Date() : undefined,
      dceFetchError: gotDce && !outcome.warnings.length ? null : (outcome.warnings.join(" ; ") || "DCE complet non obtenu").slice(0, 500),
    },
  });
  await audit({
    orgId, userId, action: "dce.retrieved", entityType: "Tender", entityId: tenderId,
    metadata: { host: platform.host, mode: settings!.mode, imported: outcome.imported, warnings: outcome.warnings },
  });
  logger.info({ orgId, tenderId, host: platform.host, ...outcome }, "retrait du DCE");
  return outcome;
}

/** Analyse IA du dossier une fois le DCE retiré à la demande (ignorée si l'IA n'est pas autorisée). */
export async function analyzeAfterRetrieval(orgId: string, tenderId: string, outcome: RetrievalOutcome): Promise<string | null> {
  if (!outcome.imported.length) return null;
  const { requestAutoAnalysis } = await import("../analysis/analysis-service");
  const { enqueue } = await import("../queue/queues");
  const auto = await requestAutoAnalysis(orgId, tenderId);
  if (!auto.analysis) return null;
  await enqueue("analyze-tender", { orgId, analysisId: auto.analysis.id }, { jobId: `analysis-${auto.analysis.id}`, attempts: 2 });
  return auto.analysis.id;
}
