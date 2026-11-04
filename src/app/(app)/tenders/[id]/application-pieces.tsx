"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleSlash, Download, FileText, Loader2, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import type { PieceGroup, PieceStatus } from "@prisma/client";
import { ActionForm, FormMessage, SubmitButton, type ActionState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/primitives";
import { fr } from "@/i18n/fr";
import { cn, formatDate } from "@/lib/utils";
import type { PieceDocAlert, PieceDocs } from "@/server/company/documents";
import { addPieceAction, createProposalAction, deletePieceAction, deletePieceFileAction, updatePieceAction } from "./actions";

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
  lotId: string | null;
  files: Array<{ id: string; filename: string; sizeBytes: number }>;
  profile: PieceDocs | null;
};

/** Pièces pour lesquelles l'application génère un formulaire pré-rempli. */
const GENERATED_FORMS: Record<string, string> = { dc1: "DC1", dc2: "DC2" };

const DOC_ALERT: Record<Exclude<PieceDocAlert, null | "missing">, { tone: "danger" | "warning"; label: string }> = {
  expired: { tone: "danger", label: "Expirée — à mettre à jour" },
  "before-deadline": { tone: "danger", label: "Expire avant la date limite" },
  expiring: { tone: "warning", label: "Expire bientôt" },
};

const ICON = { TODO: Circle, IN_PROGRESS: CircleDashed, DONE: CheckCircle2, NOT_APPLICABLE: CircleSlash } as const;
const ICON_TONE = { TODO: "text-muted-foreground", IN_PROGRESS: "text-primary", DONE: "text-success", NOT_APPLICABLE: "text-muted-foreground/60" } as const;

export type PieceSection = { key: string; title: string; group: PieceGroup; lotId: string | null; proposalId?: string };

export function ApplicationPieces({ tenderId, pieces, sections, canEdit, canCreateProposal, maxMb }: {
  tenderId: string;
  pieces: PieceView[];
  sections: PieceSection[];
  canEdit: boolean;
  canCreateProposal: boolean;
  maxMb: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => {
        const items = pieces.filter((p) => p.group === section.group && p.lotId === section.lotId);
        return (
          <section key={section.key}>
            <h4 className="mb-2 text-sm font-semibold">{section.title}</h4>
            {items.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {items.map((p) => (
                  <PieceRow
                    key={p.id}
                    piece={p}
                    tenderId={tenderId}
                    canEdit={canEdit}
                    maxMb={maxMb}
                    memoire={p.key === "memoire" ? { proposalId: section.proposalId, canCreate: canCreateProposal, lotId: section.lotId } : undefined}
                  />
                ))}
              </ul>
            )}
            {canEdit && (
              <ActionForm action={addPieceAction} resetOnSuccess className="mt-2 flex items-center gap-2">
                <input type="hidden" name="tenderId" value={tenderId} />
                <input type="hidden" name="group" value={section.group} />
                {section.lotId && <input type="hidden" name="lotId" value={section.lotId} />}
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

function PieceRow({ piece: p, tenderId, canEdit, maxMb, memoire }: {
  piece: PieceView;
  tenderId: string;
  canEdit: boolean;
  maxMb: number;
  memoire?: { proposalId?: string; canCreate: boolean; lotId: string | null };
}) {
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
          {memoire?.proposalId && <Link href={`/proposals/${memoire.proposalId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"><FileText className="size-3" /> Ouvrir le mémoire technique</Link>}
          {memoire && !memoire.proposalId && memoire.canCreate && status !== "NOT_APPLICABLE" && (
            <ActionForm action={createProposalAction} className="mt-1">
              <input type="hidden" name="tenderId" value={tenderId} />
              {memoire.lotId && <input type="hidden" name="lotId" value={memoire.lotId} />}
              <button type="submit" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><FileText className="size-3" /> Préparer le mémoire technique</button>
            </ActionForm>
          )}
          {GENERATED_FORMS[p.key] && status !== "NOT_APPLICABLE" && (
            <a href={`/api/v1/tenders/${tenderId}/forms/${p.key}`} download className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Download className="size-3" /> Télécharger le {GENERATED_FORMS[p.key]} pré-rempli (DOCX)
            </a>
          )}
          {p.files.length > 0 && <PieceFiles files={p.files} canEdit={canEdit} />}
        </div>
        {canEdit ? (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
            {status !== "NOT_APPLICABLE" && <PieceFileUpload pieceId={p.id} label={p.label} maxMb={maxMb} />}
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

function PieceFiles({ files, canEdit }: { files: PieceView["files"]; canEdit: boolean }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1 text-xs">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-1.5">
          <Paperclip className="size-3 text-muted-foreground" />
          <a href={`/api/v1/piece-files/${f.id}/download`} className="text-primary hover:underline">{f.filename}</a>
          <span className="text-muted-foreground">{formatSize(f.sizeBytes)}</span>
          {canEdit && (
            <ActionForm action={deletePieceFileAction} confirm={`Retirer « ${f.filename} » de cette pièce ?`} className="inline-flex">
              <input type="hidden" name="fileId" value={f.id} />
              <button type="submit" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-danger" aria-label={`Retirer ${f.filename}`}><X className="size-3" /></button>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/** Joint un ou plusieurs fichiers propres à la consultation (AE signé, BPU rempli, CV…). */
function PieceFileUpload({ pieceId, label, maxMb }: { pieceId: string; label: string; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const tooBig = [...files].find((f) => f.size > maxMb * 1024 * 1024);
    if (tooBig) return setError(`« ${tooBig.name} » dépasse ${maxMb} Mo.`);
    setBusy(true);
    for (const file of files) {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/v1/pieces/${pieceId}/files`, { method: "POST", body: fd });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
        break;
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => upload(e.currentTarget.files)}
      />
      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busy} onClick={() => input.current?.click()} aria-label={`Joindre un fichier : ${label}`} title="Joindre un fichier (PDF, DOCX, XLSX, JPG, PNG)">
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} Joindre
      </Button>
      {error && <span className="basis-full text-right text-xs text-danger" role="alert">{error}</span>}
    </>
  );
}
