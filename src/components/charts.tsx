"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Datum = { label: string; value: number };

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums text-foreground">
        {payload[0].value.toLocaleString("fr-FR")} {unit}
      </p>
    </div>
  );
}

/** Barres d'une seule série (magnitude) : une teinte, sans légende, info-bulle au survol. */
export function SimpleBarChart({ data, unit = "avis", height = 220 }: { data: Datum[]; unit?: string; height?: number }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Pas encore de données.</p>;
  const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
  return (
    <div style={{ height }} role="img" aria-label={data.map((d) => `${d.label} : ${d.value}`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -16 }} barCategoryGap="25%">
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip unit={unit} />} />
          <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Classement horizontal en HTML (libellés longs, cartes étroites) : une teinte, valeur affichée. */
export function BarList({ data, unit = "avis" }: { data: Datum[]; unit?: string }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Pas encore de données.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((d) => (
        <li key={d.label} className="group" title={`${d.label} : ${d.value.toLocaleString("fr-FR")} ${unit}`}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground group-hover:text-foreground">{d.label}</span>
            <span className="font-medium tabular-nums">{d.value.toLocaleString("fr-FR")}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
