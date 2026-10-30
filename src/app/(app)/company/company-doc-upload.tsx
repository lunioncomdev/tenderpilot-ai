"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import type { CompanyDocType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/primitives";
import { COMPANY_DOC_TYPES } from "@/server/company/documents";

/** Ajout d'une pièce administrative, ou remplacement du fichier d'une pièce existante. */
export function CompanyDocUpload({ maxMb, replace }: { maxMb: number; replace?: { id: string; type: CompanyDocType; label: string } }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<CompanyDocType>(replace?.type ?? "KBIS");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const months = COMPANY_DOC_TYPES[type].validityMonths;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return setMsg({ error: "Choisissez un fichier." });
    if (file.size > maxMb * 1024 * 1024) return setMsg({ error: `Le fichier dépasse ${maxMb} Mo.` });
    if (replace) fd.set("replaceId", replace.id);
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/v1/company/documents", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) return setMsg({ error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText });
    form.current?.reset();
    setMsg({ ok: replace ? "Pièce mise à jour." : "Pièce ajoutée." });
    router.refresh();
  }

  return (
    <form ref={form} onSubmit={submit} className="grid gap-3">
      {replace ? (
        <input type="hidden" name="type" value={replace.type} />
      ) : (
        <Field label="Type de pièce">
          <Select name="type" value={type} onChange={(e) => setType(e.currentTarget.value as CompanyDocType)}>
            {Object.entries(COMPANY_DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Intitulé" hint="Facultatif, ex. « ISO 27001 » pour une certification.">
        <Input name="label" defaultValue={replace?.label ?? ""} maxLength={200} placeholder={COMPANY_DOC_TYPES[type].label} />
      </Field>
      <Field label="Date de délivrance"><Input name="issuedAt" type="date" /></Field>
      <Field label="Valable jusqu'au" hint={months ? `Vide : ${months} mois après la délivrance.` : "Vide : sans échéance."}>
        <Input name="validUntil" type="date" />
      </Field>
      <Field label="Fichier" hint={`PDF, DOCX, XLSX, JPG ou PNG — ${maxMb} Mo max.`}>
        <Input name="file" type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" required />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} {replace ? "Remplacer le fichier" : "Ajouter la pièce"}</Button>
        {msg?.error && <p className="text-sm text-danger" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="text-sm text-success" role="status">{msg.ok}</p>}
      </div>
    </form>
  );
}
