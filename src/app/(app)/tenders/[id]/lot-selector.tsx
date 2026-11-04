"use client";

import { useEffect, useState, useTransition } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton, type ActionState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addLotAction, deleteLotAction, setLotSelectedAction } from "./actions";

export type LotView = { id: string; number: string; title: string; selected: boolean; fromAnalysis: boolean };

/** Choix des lots auxquels on répond ; les pièces de l'offre sont déclinées par lot retenu. */
export function LotSelector({ tenderId, lots, canEdit, hiddenPieces }: { tenderId: string; lots: LotView[]; canEdit: boolean; hiddenPieces: number }) {
  const [adding, setAdding] = useState(false);
  const selected = lots.filter((l) => l.selected).length;

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="size-4 text-muted-foreground" aria-hidden />
        <h4 className="font-semibold">Lots</h4>
        <span className="text-muted-foreground">
          {lots.length === 0
            ? "Aucun lot identifié : consultation traitée comme un marché unique."
            : selected === 0
              ? "Aucun lot retenu : cochez les lots auxquels vous répondez."
              : `${selected} lot(s) retenu(s) sur ${lots.length}. Acte d'engagement, offre financière, mémoire et cahiers sont à fournir pour chacun.`}
        </span>
        {canEdit && !adding && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setAdding(true)}><Plus /> Ajouter un lot</Button>
        )}
      </div>
      {lots.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lots.map((l) => <LotRow key={l.id} lot={l} canEdit={canEdit} />)}
        </ul>
      )}
      {hiddenPieces > 0 && (
        <p className="text-xs text-muted-foreground">{hiddenPieces} pièce(s) de lots non retenus sont conservées et réapparaîtront si vous retenez à nouveau ces lots.</p>
      )}
      {canEdit && adding && (
        <ActionForm action={addLotAction} resetOnSuccess className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tenderId" value={tenderId} />
          <Input name="number" placeholder="N°" className="h-8 w-16 text-sm" maxLength={20} required aria-label="Numéro du lot" />
          <Input name="title" placeholder="Intitulé du lot" className="h-8 min-w-48 flex-1 text-sm" maxLength={300} aria-label="Intitulé du lot" />
          <SubmitButton size="sm" variant="outline">Ajouter</SubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Annuler</Button>
        </ActionForm>
      )}
    </section>
  );
}

function LotRow({ lot, canEdit }: { lot: LotView; canEdit: boolean }) {
  // Appel direct de l'action (case à cocher) : l'état local reflète le choix sans attendre le rechargement.
  const [checked, setChecked] = useState(lot.selected);
  const [error, setError] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => setChecked(lot.selected), [lot.selected]);

  const toggle = (next: boolean) => {
    setChecked(next);
    const fd = new FormData();
    fd.set("lotId", lot.id);
    fd.set("selected", String(next));
    startTransition(async () => {
      const res = await setLotSelectedAction(null, fd);
      if (res?.error) {
        setChecked(!next);
        setError(res);
      } else setError(null);
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <label className={cn("flex flex-1 items-center gap-2", canEdit && "cursor-pointer", pending && "opacity-60")}>
        <input type="checkbox" checked={checked} disabled={!canEdit || pending} onChange={(e) => toggle(e.currentTarget.checked)} />
        <span className="font-medium">Lot n° {lot.number}</span>
        {lot.title && <span className="text-muted-foreground">— {lot.title}</span>}
        {!lot.fromAnalysis && <Badge>Ajouté à la main</Badge>}
      </label>
      {canEdit && !lot.fromAnalysis && (
        <ActionForm action={deleteLotAction} confirm={`Supprimer le lot n° ${lot.number} et ses pièces ?`}>
          <input type="hidden" name="lotId" value={lot.id} />
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Supprimer le lot ${lot.number}`}><Trash2 /></Button>
        </ActionForm>
      )}
      <FormMessage state={error} className="mt-0 basis-full" />
    </li>
  );
}
