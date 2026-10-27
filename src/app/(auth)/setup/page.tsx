import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { hasAnyUser } from "@/server/auth/accounts";
import { setupAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Initialisation" };

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Initialiser TenderPilot AI</CardTitle>
        <CardDescription>Création de l&apos;organisation et du compte propriétaire. Cette page n&apos;est disponible qu&apos;une fois.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={setupAction} className="flex flex-col gap-4">
          <Field label="Nom de l'entreprise">
            <Input name="orgName" required placeholder="Lunioncom" />
          </Field>
          <Field label="Votre nom">
            <Input name="name" required autoComplete="name" />
          </Field>
          <Field label="Adresse e-mail">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Mot de passe" hint="12 caractères minimum, avec majuscule, minuscule et chiffre.">
            <Input name="password" type="password" required autoComplete="new-password" minLength={12} />
          </Field>
          <Field label="Confirmation">
            <Input name="confirm" type="password" required autoComplete="new-password" />
          </Field>
          <SubmitButton pendingText="Création…">Créer l&apos;organisation</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
