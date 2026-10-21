import type { ReactNode } from "react";
import type { Role } from "./app-shell";
import { Redirect, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { authClient } from "../lib/auth";
import { useMe } from "../queries/me";
import { AppShell, canAccess } from "./app-shell";

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="animate-spin text-volt" />
    </div>
  );
}

export function Protected({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const me = useMe(!!session);
  const [loc] = useLocation();
  if (isPending) return <Loading />;
  if (!session) return <Redirect to="/entrar" />;
  if (me.isLoading) return <Loading />;
  if (me.data && !canAccess("/" + loc.split("/")[1], me.data.role as Role)) return <Redirect to="/" />;
  return <AppShell>{children}</AppShell>;
}
