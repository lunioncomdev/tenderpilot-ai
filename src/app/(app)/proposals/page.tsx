import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";

export const metadata = { title: "Mémoires techniques" };

const STATUS = { DRAFT: "Brouillon", GENERATING: "Génération", IN_REVIEW: "En relecture", VALIDATED: "Validé" } as const;

export default async function ProposalsPage() {
  const ctx = await requireContext();
  const proposals = await prisma.proposal.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    include: { tender: { select: { id: true, title: true, deadlineAt: true } }, sections: { select: { status: true } } },
  });
  return (
    <>
      <PageHeader title="Mémoires techniques" description="Un mémoire se crée depuis la fiche d'un appel d'offres analysé." />
      {proposals.length === 0 ? (
        <EmptyState title="Aucun mémoire">Ouvrez un appel d&apos;offres, importez et analysez son DCE, puis cliquez sur « Préparer le mémoire technique ».</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead className="border-b"><tr><Th>Mémoire</Th><Th>Avancement</Th><Th>Statut</Th><Th>Mis à jour</Th></tr></thead>
            <tbody className="divide-y">
              {proposals.map((p) => {
                const done = p.sections.filter((s) => s.status === "VALIDATED").length;
                const drafted = p.sections.filter((s) => ["AI_DRAFT", "EDITED", "VALIDATED"].includes(s.status)).length;
                return (
                  <tr key={p.id} className="hover:bg-muted/50">
                    <Td><Link className="font-medium hover:underline" href={`/proposals/${p.id}`}>{p.tender.title}</Link></Td>
                    <Td className="text-xs text-muted-foreground">{drafted}/{p.sections.length} rédigées · {done} validées</Td>
                    <Td><Badge tone={p.status === "VALIDATED" ? "success" : "primary"}>{STATUS[p.status]}</Badge></Td>
                    <Td className="whitespace-nowrap">{formatDateTime(p.updatedAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
