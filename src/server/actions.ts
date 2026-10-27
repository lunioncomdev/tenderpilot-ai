import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { AiNotAllowedError } from "./ai/gateway";
import { ForbiddenError, NotFoundError } from "./auth/rbac";
import { UploadRejectedError } from "./documents/document-service";
import { logger } from "./logger";

/** Exécute une Server Action et convertit les erreurs connues en message utilisateur. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of err.issues) fieldErrors[i.path.join(".")] ??= i.message;
      const first = err.issues[0];
      return { error: `${first.path.join(".") ? `${first.path.join(".")} : ` : ""}${first.message}`, fieldErrors };
    }
    if (err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof AiNotAllowedError || err instanceof UploadRejectedError) {
      return { error: err.message };
    }
    if (err instanceof Error && /ECONNREFUSED|Connection is closed|connect ETIMEDOUT/.test(err.message)) {
      logger.error({ err }, "service indisponible");
      return { error: "Service de tâches (Redis) indisponible : réessayez dans un instant." };
    }
    logger.error({ err }, "erreur d'action");
    return { error: err instanceof Error && err.message.length < 300 ? err.message : "Une erreur inattendue est survenue." };
  }
}

export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}
