import { Radar } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-accent/60 to-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Radar className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">TenderPilot AI</span>
        </div>
        {children}
      </div>
    </div>
  );
}
