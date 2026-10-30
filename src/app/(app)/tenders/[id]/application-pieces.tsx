"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleSlash, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import type { PieceGroup, PieceStatus } from "@prisma/client";
import { ActionForm, FormMessage, SubmitButton, type ActionState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { cn, formatDate } from "@/lib/utils";
import type { PieceDocAlert, PieceDocs } from "@/server/company/documents";
import { addPieceAction, deletePieceAction, updatePieceAction } from "./actions";

export type PieceView = {
  id: string;
  key: string;
  group: PieceGroup;
  label: string;
  detail: string;
  source: string;
  fromDce: boolean;
  status: PieceStatus;
  note: string;
  profile: PieceDocs | null;
};

const DOC_ALERT: Record<Exclude<PieceDocAlert, null | "missing">, { tone: "danger" | "warning"; label: string }> = {
  expired: { tone: "danger", label: "Expirée — à mettre à jour" },
  "before-deadline": { tone: "danger", label: "Expire avant la date limite" },
  expiring: { tone: "warning", label: "Expire bientôt" },
};

const ICON = { TODO: Circle, IN_PROGRESS: CircleDashed, DONE: CheckCircle2, NOT_APPLICABLE: CircleSlash } as const;
const ICON_TONE = { TODO: "text-muted-foreground", IN_PROGRESS: "text-primary", DONE: "text-success", NOT_APPLICABLE: "text-muted-foreground/60" } as const;

export function ApplicationPieces({ tenderId, pieces, canEdit, proposalId }: { tenderId: string; pieces: PieceView[]; canEdit: boolean; proposalId?: string }) {
  return (
    <div className="flex flex-col gap-5">
      {(["CANDIDATURE", "OFFRE"] as const).map((group) => {
        const items = pieces.filter((p) => p.group === group);
        return (
          <section key={group}>
            <h4 className="mb-2 text-sm font-semibold">{fr.pieceGroup[group]}</h4>
            {items.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {items.map((p) => <PieceRow key={p.id} piece={p} canEdit={canEdit} proposalId={p.key === "memoire" ? proposalId : undefined} />)}
              </ul>
            )}
            {canEdit && (
              <ActionForm action={addPieceAction} resetOnSuccess className="mt-2 flex items-center gap-2">
                <input type="hidden" name="tenderId" value={tenderId} />
                <input type="hidden" name="group" value={group} />
                <Input name="label" placeholder="Ajouter une pièce…" className="h-8 text-sm" maxLength={250} required />
                <SubmitButton size="sm" variant="ghost" aria-label="Ajouter la pièce"><Plus /></SubmitButton>
              </ActionForm>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PieceRow({ piece: p, canEdit, proposalId }: { piece: PieceView; canEdit: boolean; proposalId?: string }) {
  // Appel direct de l'action, sans <form> : React 19 réinitialise les champs d'un
  // formulaire après une Server Action, ce qui réaffichait l'ancien statut.
  const [status, setStatus] = useState(p.status);
  const [note, setNote] = useState(p.note);
  const [error, setError] = useState<ActionState>(null);
  const [, startTransition] = useTransition();
  useEffect(() => setStatus(p.status), [p.status]);
  useEffect(() => setNote(p.note), [p.note]);

  const save = (next: { status: PieceStatus; note: string }) => {
    setStatus(next.status);
    setNote(next.note);
    const fd = new FormData();
    fd.set("pieceId", p.id);
    fd.set("status", next.status);
    fd.set("note", next.note);
    startTransition(async () => {
      const res = await updatePieceAction(null, fd);
      setError(res?.error ? res : null);
      if (res?.error) {
        setStatus(p.status);
        setNote(p.note);
      }
    });
  };

  const Icon = ICON[status];
  return (
    <li className={cn("flex flex-col gap-2 p-3 text-sm", status === "NOT_APPLICABLE" && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[status])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", status === "NOT_APPLICABLE" && "line-through")}>
            {p.label}
            {p.fromDce && <Badge tone="primary" className="ml-2 align-middle">Exigé par le DCE</Badge>}
          </p>
          {p.detail && p.detail !== p.label && <p className="mt-0.5 text-xs text-muted-foreground">{p.detail}</p>}
          {p.source && <p className="mt-0.5 text-xs text-muted-foreground">Source : {p.source}</p>}
          {p.profile && status !== "NOT_APPLICABLE" && <ProfileDocs profile={p.profile} />}
          {proposalId && <Link href={`/proposals/${proposalId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"><FileText className="size-3" /> Ouvrir le mémoire technique</Link>}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Select
              value={status}
              onChange={(e) => save({ status: e.currentTarget.value as PieceStatus, note })}
              className="h-8 w-36 text-xs"
              aria-label={`Avancement : ${p.label}`}
            >
              {Object.entries(fr.pieceStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {p.key.startsWith("custom-") && (
              <ActionForm action={deletePieceAction} confirm="Supprimer cette pièce ?">
                <input type="hidden" name="pieceId" value={p.id} />
                <Button variant="ghost" size="icon" aria-label="Supprimer la pièce"><Trash2 /></Button>
              </ActionForm>
            )}
          </div>
        ) : (
          <Badge>{fr.pieceStatus[p.status]}</Badge>
        )}
      </div>
      {canEdit ? (
        <div className="pl-7">
          <Input
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            onBlur={() => { if (note !== p.note) save({ status, note }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder="Note (où trouver la pièce, qui s'en charge…)"
            className="h-7 border-transparent bg-transparent px-1 text-xs shadow-none hover:border-input focus:border-input"
            maxLength={1000}
            aria-label={`Note : ${p.label}`}
          />
        </div>
      ) : p.note ? (
        <p className="pl-7 text-xs text-muted-foreground">{p.note}</p>
      ) : null}
      <FormMessage state={error} className="mt-0 pl-7" />
    </li>
  );
}

function ProfileDocs({ profile }: { profile: PieceDocs }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-xs">
      {profile.docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-1.5">
          <Paperclip className="size-3 text-muted-foreground" />
          <a href={`/api/v1/company/documents/${d.id}/download`} className="text-primary hover:underline">{d.label}</a>
          <span className="text-muted-foreground">{d.validUntil ? `valable jusqu'au ${formatDate(d.validUntil)}` : "sans échéance"}</span>
          {d.alert && d.alert !== "missing" && (
            <>
              <Badge tone={DOC_ALERT[d.alert].tone}>{DOC_ALERT[d.alert].label}</Badge>
              <Link href="/company#pieces" className="text-primary hover:underline">Mettre à jour</Link>
            </>
          )}
        </div>
      ))}
      {profile.missing.map((m) => (
        <div key={m} className="flex flex-wrap items-center gap-1.5">
          <AlertTriangle className="size-3 text-warning" />
          <span className="text-muted-foreground">Absente du profil : {m}</span>
          <Link href="/company#pieces" className="text-primary hover:underline">Ajouter</Link>
        </div>
      ))}
    </div>
  );
}
