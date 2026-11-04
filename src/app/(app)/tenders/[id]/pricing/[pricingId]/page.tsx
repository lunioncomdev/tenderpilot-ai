import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, RefreshCw, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { requireContext } from "@/server/auth/context";
import { hasRole, NotFoundError } from "@/server/auth/rbac";
import { loadPricing } from "@/server/pricing/pricing-service";
import { deletePricingAction, preparePricingAction } from "../../actions";
import { PricingGrid } from "./pricing-grid";

export const metadata = { title: "Chiffrage" };

export default async function PricingPage({ params }: { params: Promise<{ id: string; pricingId: string }> }) {
  const { id, pricingId } = await params;
  const ctx = await requireContext();
  let data: Awaited<ReturnType<typeof loadPricing>>;
  try {
    data = await loadPricing(ctx.orgId, pricingId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { pricing, lines, rates } = data;
  if (pricing.tenderId !== id) notFound();
  const canEdit = hasRole(ctx.role, "MEMBER");

  return (
    <div>
      <Link href={`/tenders/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {pricing.tender.title}</Link>
      <PageHeader
        title={`Chiffrage — ${pricing.document.filename}`}
        description="Prix unitaire = Σ (jours × TJM) ajusté du pourcentage global, ou prix saisi directement. Seules les cellules de prix vides du modèle sont remplies ; ses formules recalculent les montants à l'ouverture."
        actions={
          <>
            <a href={`/api/v1/pricings/${pricing.id}/export`} className={buttonVariants()} download><Download /> Bordereau rempli (.xlsx)</a>
            {canEdit && (
              <>
                <ActionForm action={preparePricingAction} confirm="Relire le bordereau ? Les saisies des lignes inchangées sont conservées.">
                  <input type="hidden" name="tenderId" value={id} />
                  <input type="hidden" name="documentId" value={pricing.documentId} />
                  <SubmitButton variant="outline" pendingText="Analyse…"><RefreshCw /> Relire le bordereau</SubmitButton>
                </ActionForm>
                <ActionForm action={deletePricingAction} confirm="Supprimer ce chiffrage et toutes ses saisies ?">
                  <input type="hidden" name="pricingId" value={pricing.id} />
                  <Button variant="ghost" size="icon" aria-label="Supprimer le chiffrage"><Trash2 /></Button>
                </ActionForm>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        {rates.length === 0 && (
          <Alert tone="warning">
            Aucun TJM dans le <Link href="/company" className="underline">profil entreprise</Link> : renseignez vos profils et taux journaliers pour chiffrer en jours, ou saisissez les prix unitaires directement.
          </Alert>
        )}
        {pricing.warnings.length > 0 && (
          <Alert>
            <ul className="list-disc pl-4 text-sm">{pricing.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Alert>
        )}
      </div>
      <PricingGrid
        pricingId={pricing.id}
        canEdit={canEdit}
        rates={rates}
        adjustmentPercent={pricing.adjustmentPercent}
        lines={lines.map((l) => ({
          id: l.id, sheet: l.sheet, row: l.row, isHeading: l.isHeading, reference: l.reference, designation: l.designation, unit: l.unit,
          quantity: l.quantity, priceCell: l.priceCell, manualPrice: l.manualPrice, days: l.days, note: l.note,
        }))}
      />
    </div>
  );
}
