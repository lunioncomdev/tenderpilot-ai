"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import type { ActionState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { linePrice, parseDecimal, pricingTotals, type DailyRate, type Days } from "@/server/pricing/compute";
import { savePricingAction } from "../../actions";

export type GridLine = {
  id: string;
  sheet: string;
  row: number;
  isHeading: boolean;
  reference: string;
  designation: string;
  unit: string;
  quantity: number | null;
  priceCell: string | null;
  manualPrice: number | null;
  days: Days;
  note: string;
};

type Entry = { days: Record<string, string>; manual: string };

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export function PricingGrid({ pricingId, canEdit, rates, adjustmentPercent, lines }: { pricingId: string; canEdit: boolean; rates: DailyRate[]; adjustmentPercent: number; lines: GridLine[] }) {
  const initial = useMemo(
    () => Object.fromEntries(lines.map((l) => [l.id, { manual: str(l.manualPrice), days: Object.fromEntries(rates.map((r) => [r.profile, str(l.days[r.profile])])) }])) as Record<string, Entry>,
    [lines, rates],
  );
  const [entries, setEntries] = useState(initial);
  const [adjust, setAdjust] = useState(str(adjustmentPercent));
  const [dirty, setDirty] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const adj = parseDecimal(adjust) ?? 0;
  const computed = lines.map((l) => {
    const e = entries[l.id];
    const days: Days = { ...l.days };
    for (const r of rates) {
      const d = parseDecimal(e.days[r.profile]);
      if (d && d > 0) days[r.profile] = d;
      else delete days[r.profile];
    }
    const manualPrice = parseDecimal(e.manual);
    const line = { isHeading: l.isHeading, quantity: l.quantity, manualPrice: manualPrice !== null && manualPrice >= 0 ? manualPrice : null, days };
    return { line, price: linePrice(line, rates, adj) };
  });
  const totals = pricingTotals(computed.map((c) => c.line), rates, adj);
  const hasQuantities = lines.some((l) => !l.isHeading && l.quantity !== null);

  const edit = (id: string, patch: (e: Entry) => Entry) => {
    setEntries((s) => ({ ...s, [id]: patch(s[id]) }));
    setDirty(true);
    setState(null);
  };

  const save = () => {
    const fd = new FormData();
    fd.set("pricingId", pricingId);
    fd.set(
      "payload",
      JSON.stringify({
        adjustmentPercent: adj,
        profiles: rates.map((r) => r.profile),
        lines: lines.map((l, i) => ({ id: l.id, manualPrice: computed[i].line.manualPrice, days: computed[i].line.days, note: l.note })),
      }),
    );
    startTransition(async () => {
      const res = await savePricingAction(null, fd);
      setState(res);
      if (!res?.error) setDirty(false);
    });
  };

  let lastSheet = "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Ajustement global des prix calculés (%)</span>
          <Input value={adjust} onChange={(e) => { setAdjust(e.currentTarget.value); setDirty(true); }} inputMode="decimal" className="w-32" disabled={!canEdit} aria-describedby="adjust-hint" />
          <span id="adjust-hint" className="text-xs text-muted-foreground">-5 = remise de 5 % ; ne s&apos;applique pas aux prix saisis.</span>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Lignes chiffrées</span>
          <span className="text-lg font-semibold">{totals.priced} / {totals.lines}</span>
        </div>
        {hasQuantities && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Total HT (lignes avec quantité)</span>
            <span className="text-lg font-semibold">{money.format(totals.totalHt)}</span>
          </div>
        )}
        {Object.keys(totals.daysByProfile).length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Charge (jours × quantités)</span>
            <span>{Object.entries(totals.daysByProfile).map(([p, d]) => `${p} : ${num.format(d)} j`).join(" · ")}</span>
          </div>
        )}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.currentTarget.checked)} />
          Lignes non chiffrées uniquement
        </label>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">Réf.</th>
              <th className="min-w-64 px-2 py-2">Désignation</th>
              <th className="px-2 py-2">Unité</th>
              <th className="px-2 py-2 text-right">Qté</th>
              {rates.map((r) => (
                <th key={r.profile} className="px-2 py-2 text-right" title={`${money.format(r.rate)} / jour`}>
                  {r.profile}<br /><span className="normal-case">jours · {num.format(r.rate)} €</span>
                </th>
              ))}
              <th className="px-2 py-2 text-right">PU calculé</th>
              <th className="px-2 py-2 text-right">PU saisi</th>
              <th className="px-2 py-2 text-right">PU retenu</th>
              {hasQuantities && <th className="px-2 py-2 text-right">Montant HT</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const { price } = computed[i];
              if (onlyMissing && (l.isHeading || price.unitPrice !== null)) return null;
              const sheetRow = l.sheet !== lastSheet ? (lastSheet = l.sheet) : null;
              const cols = 7 + rates.length + (hasQuantities ? 1 : 0);
              const calc = price.source === "computed" ? price.unitPrice : linePrice({ ...computed[i].line, manualPrice: null }, rates, adj).unitPrice;
              return (
                <Fragment key={l.id}>
                  {sheetRow && <tr className="border-t bg-muted/30"><td colSpan={cols} className="px-2 py-1.5 text-xs font-semibold">Feuille « {sheetRow} »</td></tr>}
                  {l.isHeading ? (
                    <tr className="border-t">
                      <td className="px-2 py-2 text-xs text-muted-foreground">{l.reference}</td>
                      <td colSpan={cols - 1} className="px-2 py-2 font-semibold">{l.designation}</td>
                    </tr>
                  ) : (
                    <tr className={cn("border-t align-top", price.unitPrice === null && "bg-warning/5")}>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">{l.reference}</td>
                      <td className="px-2 py-1.5">
                        {l.designation}
                        <span className="ml-1 text-xs text-muted-foreground">({l.priceCell})</span>
                        {price.unknownProfiles.length > 0 && <p className="text-xs text-warning">Profil absent de la grille de TJM : {price.unknownProfiles.join(", ")}</p>}
                      </td>
                      <td className="px-2 py-1.5 text-xs">{l.unit}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity === null ? "—" : num.format(l.quantity)}</td>
                      {rates.map((r) => (
                        <td key={r.profile} className="px-1 py-1">
                          <Input
                            value={entries[l.id].days[r.profile] ?? ""}
                            onChange={(e) => { const v = e.currentTarget.value; edit(l.id, (s) => ({ ...s, days: { ...s.days, [r.profile]: v } })); }}
                            inputMode="decimal"
                            className="h-8 w-20 text-right tabular-nums"
                            disabled={!canEdit}
                            aria-label={`Jours ${r.profile} — ${l.designation}`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{calc === null ? "—" : money.format(calc)}</td>
                      <td className="px-1 py-1">
                        <Input
                          value={entries[l.id].manual}
                          onChange={(e) => { const v = e.currentTarget.value; edit(l.id, (s) => ({ ...s, manual: v })); }}
                          inputMode="decimal"
                          className="h-8 w-28 text-right tabular-nums"
                          placeholder="—"
                          disabled={!canEdit}
                          aria-label={`Prix unitaire saisi — ${l.designation}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{price.unitPrice === null ? <span className="text-warning">à chiffrer</span> : money.format(price.unitPrice)}</td>
                      {hasQuantities && <td className="px-2 py-1.5 text-right tabular-nums">{price.amount === null ? "—" : money.format(price.amount)}</td>}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" onClick={save} disabled={pending || !dirty}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer le chiffrage</Button>
          {dirty && !pending && <span className="text-sm text-muted-foreground">Modifications non enregistrées.</span>}
          {state?.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
          {state?.ok && !dirty && <span className="text-sm text-success" role="status">{state.message ?? "Enregistré."}</span>}
        </div>
      )}
    </div>
  );
}
