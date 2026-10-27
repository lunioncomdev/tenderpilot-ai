"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | null;
export type FormAction = (prev: ActionState, data: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** Formulaire branché sur une Server Action, avec retour d'état explicite. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  confirm,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (!state || (!state.error && !state.message)) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={cn("mt-2 text-sm", state.error ? "text-danger" : "text-success", className)}>
      {state.error ?? state.message}
    </p>
  );
}
