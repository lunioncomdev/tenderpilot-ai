"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Rafraîchit la page tant qu'un traitement asynchrone est en cours. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}

export function UploadDocuments({ tenderId, maxMb }: { tenderId: string; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    const errors: string[] = [];
    let ok = 0;
    for (const f of Array.from(files)) {
      if (f.size > maxMb * 1024 * 1024) {
        errors.push(`${f.name} : dépasse ${maxMb} Mo`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/v1/tenders/${tenderId}/documents`, { method: "POST", body: fd });
      if (res.ok) ok++;
      else errors.push(`${f.name} : ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText}`);
    }
    setBusy(false);
    setMsg(errors.length ? { error: errors.join(" · ") } : { ok: `${ok} fichier(s) importé(s), extraction en cours…` });
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-5 text-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files);
      }}
    >
      <p className="text-sm text-muted-foreground">Glissez les pièces du DCE (PDF, DOCX, XLSX, TXT, ZIP — {maxMb} Mo max.)</p>
      <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.txt,.zip" onChange={(e) => void upload(e.target.files)} />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} Importer des fichiers
      </Button>
      {msg?.error && <p className="text-sm text-danger" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="text-sm text-success">{msg.ok}</p>}
    </div>
  );
}
