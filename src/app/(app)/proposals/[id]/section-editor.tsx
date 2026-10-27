"use client";

import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";

/** Édition Markdown d'une section avec aperçu (le rendu est fourni par le serveur). */
export function SectionEditor({
  sectionId,
  content,
  preview,
  disabled,
  action,
}: {
  sectionId: string;
  content: string;
  preview: React.ReactNode;
  disabled: boolean;
  action: FormAction;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="flex flex-col gap-2">
        {content ? preview : <p className="text-sm italic text-muted-foreground">Section non rédigée.</p>}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setEditing(true)}>
            <Pencil /> Modifier
          </Button>
        )}
      </div>
    );
  }
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      <input type="hidden" name="sectionId" value={sectionId} />
      <Textarea name="content" defaultValue={content} className="min-h-80 font-mono text-xs" aria-label="Contenu Markdown" />
      <p className="text-xs text-muted-foreground">Markdown : ### titre, - liste, **gras**, tableaux | a | b |. Les marqueurs [À VALIDER] restent surlignés à l&apos;export.</p>
      <div className="flex gap-2">
        <SubmitButton size="sm">Enregistrer une version</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}><Eye /> Annuler</Button>
      </div>
    </ActionForm>
  );
}
