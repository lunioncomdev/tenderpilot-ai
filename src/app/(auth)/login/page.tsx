import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { hasAnyUser } from "@/server/auth/accounts";
import { getContext } from "@/server/auth/context";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connexion" };

export default async function LoginPage() {
  if (await getContext()) redirect("/dashboard");
  const initialized = await hasAnyUser();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connexion</CardTitle>
        <CardDescription>Accédez à votre veille et à vos candidatures.</CardDescription>
      </CardHeader>
      <CardContent>
        {!initialized ? (
          <p className="text-sm">
            Aucun compte n&apos;existe encore.{" "}
            <Link className="font-medium text-primary underline" href="/setup">
              Initialiser l&apos;application
            </Link>
          </p>
        ) : (
          <ActionForm action={loginAction} className="flex flex-col gap-4">
            <Field label="Adresse e-mail">
              <Input name="email" type="email" autoComplete="email" required autoFocus />
            </Field>
            <Field label="Mot de passe">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton pendingText="Connexion…">Se connecter</SubmitButton>
          </ActionForm>
        )}
      </CardContent>
    </Card>
  );
}
