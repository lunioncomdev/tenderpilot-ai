"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { formObject, runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { authenticate, createOrganizationWithOwner, hasAnyUser } from "@/server/auth/accounts";
import { clearSessionCookie, getContext, setSessionCookie } from "@/server/auth/context";
import { PasswordSchema } from "@/server/auth/password";
import { rateLimit } from "@/server/auth/rate-limit";
import { createSession, invalidateSession, SESSION_COOKIE } from "@/server/auth/session";
import { cookies } from "next/headers";

async function clientMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null, userAgent: h.get("user-agent") };
}

const LoginSchema = z.object({ email: z.email("Adresse e-mail invalide"), password: z.string().min(1, "Mot de passe requis").max(200) });

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const { email, password } = LoginSchema.parse(formObject(fd));
    const meta = await clientMeta();
    if (!(await rateLimit(`login:${meta.ip ?? "?"}:${email.toLowerCase()}`, 8, 900))) {
      return { error: "Trop de tentatives. Réessayez dans 15 minutes." };
    }
    const auth = await authenticate(email, password);
    if (!auth) return { error: "Identifiants incorrects." };
    const { token, expiresAt } = await createSession(auth.user.id, auth.orgId, meta);
    await setSessionCookie(token, expiresAt);
    await audit({ orgId: auth.orgId, userId: auth.user.id, action: "auth.login", entityType: "User", entityId: auth.user.id, metadata: { ip: meta.ip } });
    return { ok: true };
  });
  if (res?.ok) redirect("/dashboard");
  return res;
}

const SetupSchema = z
  .object({
    orgName: z.string().trim().min(2, "Nom de l'entreprise requis").max(120),
    name: z.string().trim().min(2, "Nom requis").max(120),
    email: z.email("Adresse e-mail invalide"),
    password: PasswordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: "Les mots de passe ne correspondent pas", path: ["confirm"] });

export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    if (await hasAnyUser()) return { error: "L'application est déjà initialisée. Connectez-vous." };
    const data = SetupSchema.parse(formObject(fd));
    const { org, user } = await createOrganizationWithOwner(data);
    const { token, expiresAt } = await createSession(user.id, org.id, await clientMeta());
    await setSessionCookie(token, expiresAt);
    await audit({ orgId: org.id, userId: user.id, action: "org.created", entityType: "Organization", entityId: org.id });
    return { ok: true };
  });
  if (res?.ok) redirect("/company");
  return res;
}

export async function logoutAction() {
  const ctx = await getContext();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  await clearSessionCookie();
  if (ctx) await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "auth.logout", entityType: "User", entityId: ctx.userId });
  redirect("/login");
}
