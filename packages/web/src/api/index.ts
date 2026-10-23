import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { ping } from "./routes/ping";
import { me, users } from "./routes/users";
import { hr } from "./routes/hr";
import { recruitment } from "./routes/recruitment";
import { commissionTablesRoute } from "./routes/commission-tables";
import { chiefTablesRoute } from "./routes/chief-tables";
import { sales } from "./routes/sales";
import { reports } from "./routes/reports";
import { campaigns } from "./routes/campaigns";
import { agenda } from "./routes/agenda";
import { d2d } from "./routes/d2d";
import { simulador } from "./routes/simulador";
import { simuladorStore } from "./lib/simulador-store";
import { syncCatalog } from "./routes/campaigns";
import { handle as aiHandle } from "./lib/simulador-ai.mjs";
import { handle as campanhasHandle } from "./lib/simulador-campanhas.mjs";

export const router = {
  ping,
  me,
  users,
  hr,
  recruitment,
  commissionTables: commissionTablesRoute,
  chiefTables: chiefTablesRoute,
  sales,
  reports,
  campaigns,
  agenda,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
d2d(app);
simulador(app);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Simulador Iberdrola — backend routes
app.all("/api/ai", (c) => aiHandle(c.req.raw, process.env));
app.all("/api/campanhas", async (c) => {
  const res = await campanhasHandle(c.req.raw, process.env, simuladorStore);
  if (c.req.method === "POST" && res.ok) syncCatalog().catch(() => {});
  return res;
});

export default app;