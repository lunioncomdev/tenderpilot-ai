import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLot, deleteLot, generateApplicationPieces, setLotSelected, startApplication } from "@/server/applications/application-service";
import { buildDossierZip, buildFormDocx } from "@/server/applications/dossier-export";
import { visiblePieces } from "@/server/applications/lots";
import { savePieceFile } from "@/server/applications/piece-files";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { prisma } from "@/server/db";
import { makePdf } from "../helpers/fixtures-builders";

let orgId: string;
let userId: string;
let tenderId: string;

const analysisResult = {
  summary: "Refonte du portail en deux lots.",
  lots: [{ number: "Lot 1", title: "Développement", sources: [] }, { number: "Lot 02", title: "TMA", sources: [] }],
  mandatoryDocuments: [], requiredCertifications: [], siteVisitMandatory: false, awardCriteria: [], technicalRequirements: [],
};

async function lotsOf() {
  return prisma.tenderLot.findMany({ where: { tenderId }, orderBy: { order: "asc" } });
}

async function activePieces() {
  const [pieces, lots] = await Promise.all([prisma.applicationPiece.findMany({ where: { tenderId } }), lotsOf()]);
  return visiblePieces(pieces, lots.filter((l) => l.selected).map((l) => l.id));
}

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org Lots (test)", email: "lots@test.local", name: "Camille Martin", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
  userId = a.user.id;
  const t = await prisma.tender.create({
    data: { organizationId: orgId, origin: "MANUAL", externalId: "lots-1", publicationRef: "26-777", dedupKey: "lots-1", title: "Refonte du portail", deadlineAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  tenderId = t.id;
  await prisma.tenderAnalysis.create({ data: { organizationId: orgId, tenderId, status: "DONE", result: analysisResult, finishedAt: new Date() } });
  await startApplication(orgId, tenderId, userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("consultation allotie", () => {
  it("reprend les lots de l'analyse et génère d'abord un dossier sans lot retenu", async () => {
    await generateApplicationPieces(orgId, tenderId, userId);
    expect((await lotsOf()).map((l) => [l.number, l.title, l.selected])).toEqual([["1", "Développement", false], ["2", "TMA", false]]);
    const ae = (await activePieces()).filter((p) => p.key === "ae");
    expect(ae).toHaveLength(1);
    expect(ae[0].lotId).toBeNull();
  });

  it("interdit les doublons de pièce commune (index NULLS NOT DISTINCT)", async () => {
    await expect(prisma.applicationPiece.create({ data: { organizationId: orgId, tenderId, key: "ae", group: "OFFRE", order: 99, label: "doublon" } })).rejects.toThrow();
  });

  it("retenir deux lots décline l'offre par lot et conserve le travail déjà fait", async () => {
    const commonAe = (await activePieces()).find((p) => p.key === "ae")!;
    await savePieceFile({ orgId, userId, pieceId: commonAe.id, filename: "AE.pdf", data: makePdf(["AE"]) });
    const [l1, l2] = await lotsOf();
    await setLotSelected(orgId, l1.id, true, userId);
    await setLotSelected(orgId, l2.id, true, userId);

    const active = await activePieces();
    const ae = active.filter((p) => p.key === "ae");
    expect(ae.map((p) => p.lotId).sort()).toEqual([l1.id, l2.id].sort());
    // La pièce travaillée (fichier joint, « En cours ») est passée au lot 1.
    const moved = await prisma.applicationPiece.findUniqueOrThrow({ where: { id: commonAe.id }, include: { files: true } });
    expect([moved.lotId, moved.status, moved.files.length]).toEqual([l1.id, "IN_PROGRESS", 1]);
    expect(active.filter((p) => p.key === "kbis")).toHaveLength(1);
    expect(active.filter((p) => p.key === "rib").map((p) => p.lotId)).toEqual([null]);
  });

  it("écarter un lot masque ses pièces sans les supprimer, et les retrouve ensuite", async () => {
    const [, l2] = await lotsOf();
    const before = await prisma.applicationPiece.count({ where: { tenderId } });
    await setLotSelected(orgId, l2.id, false, userId);
    expect((await activePieces()).some((p) => p.lotId === l2.id)).toBe(false);
    expect(await prisma.applicationPiece.count({ where: { tenderId } })).toBe(before);
    await setLotSelected(orgId, l2.id, true, userId);
    expect((await activePieces()).filter((p) => p.lotId === l2.id)).toHaveLength(4);
    expect(await prisma.applicationPiece.count({ where: { tenderId } })).toBe(before);
  });

  it("ajoute et supprime un lot saisi à la main ; refuse de supprimer un lot de l'analyse", async () => {
    const lot = await addLot(orgId, tenderId, userId, { number: "Lot 3", title: "Hébergement" });
    expect([lot.number, lot.selected]).toEqual(["3", true]);
    expect((await activePieces()).filter((p) => p.lotId === lot.id).map((p) => p.key).sort()).toEqual(["ae", "cahiers", "memoire", "prix"]);
    await expect(addLot(orgId, tenderId, userId, { number: "3", title: "x" })).rejects.toThrow(/existe déjà/);
    await deleteLot(orgId, lot.id, userId);
    expect(await prisma.applicationPiece.count({ where: { lotId: lot.id } })).toBe(0);
    const [l1] = await lotsOf();
    await expect(deleteLot(orgId, l1.id, userId)).rejects.toThrow(/décochez/);
  });

  it("exporte un ZIP avec un dossier par lot et un DC1 qui coche les lots retenus", async () => {
    const [l1] = await lotsOf();
    await prisma.proposal.create({ data: { organizationId: orgId, tenderId, lotId: l1.id, title: "Mémoire lot 1" } });
    const { buf } = await buildDossierZip(orgId, tenderId, "Org");
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names.some((n) => /^02_Offre\/Lot_1_Developpement\/\d\d_Acte_d_engagement_complete_et_signe\.pdf$/.test(n))).toBe(true);
    expect(names.some((n) => /^02_Offre\/Lot_1_Developpement\/\d\d_Memoire_technique\.docx$/.test(n))).toBe(true);
    expect(names.some((n) => n.startsWith("02_Offre/Lot_2_TMA/"))).toBe(false); // rien de prêt pour le lot 2
    const sommaire = await zip.file("00_Sommaire.txt")!.async("string");
    expect(sommaire).toContain("OFFRE — LOT N° 2 — TMA");
    expect(sommaire).toContain("mémoire technique du lot non créé");

    const dc1 = await buildFormDocx(orgId, tenderId, "dc1", "Org");
    const xml = await (await JSZip.loadAsync(dc1.buf)).file("word/document.xml")!.async("string");
    expect(xml).toContain("☒ Tous les lots");
    expect(xml).toContain("☒ Lot n° 2 — TMA");
  });

  it("revenir à une candidature sans lot rend la pièce et le mémoire communs", async () => {
    const [l1, l2] = await lotsOf();
    await setLotSelected(orgId, l1.id, false, userId);
    await setLotSelected(orgId, l2.id, false, userId);
    const ae = (await activePieces()).filter((p) => p.key === "ae");
    expect(ae).toHaveLength(1);
    expect(ae[0].lotId).toBeNull();
    expect((await prisma.applicationPieceFile.count({ where: { pieceId: ae[0].id } }))).toBe(1);
    expect((await prisma.proposal.findFirstOrThrow({ where: { tenderId } })).lotId).toBeNull();
  });
});
