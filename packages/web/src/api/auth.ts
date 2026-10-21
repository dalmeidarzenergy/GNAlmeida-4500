import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { runableManagedAuth } from "@runablehq/managed-auth/server";
import { eq } from "drizzle-orm";
import { db } from "./database";
import { user } from "./database/auth-schema";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  // Registo livre fechado: só entra quem foi criado por alguém com permissão (Utilizadores e perfis).
  emailAndPassword: { enabled: true, disableSignUp: true },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin");
    return origin ? [origin] : ["*"];
  },
  plugins: [
    ...runableManagedAuth({
      applicationId: process.env.APPLICATION_ID!,
      issuer: process.env.VITE_RUNABLE_AUTH_ISSUER!,
    }),
    expo(),
  ],
  hooks: {
    // Login com Google (managed auth) só para emails já criados em Utilizadores.
    // O token é verificado à frente pelo endpoint do managed auth; aqui apenas lemos o email para recusar cedo.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/managed/exchange") return;
      const token = (ctx.body as { token?: string } | undefined)?.token;
      const part = typeof token === "string" ? token.split(".")[1] : undefined;
      if (!part) throw new APIError("UNAUTHORIZED", { message: "Login inválido." });
      let email: string | undefined;
      try {
        email = (JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string }).email;
      } catch {
        throw new APIError("UNAUTHORIZED", { message: "Login inválido." });
      }
      if (!email) throw new APIError("UNAUTHORIZED", { message: "Login inválido." });
      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (!existing) throw new APIError("UNAUTHORIZED", { message: "Este email não tem acesso. Pede a um Administrador que crie a tua conta." });
    }),
  },
});
