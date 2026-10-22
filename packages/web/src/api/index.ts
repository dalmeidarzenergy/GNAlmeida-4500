import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { ping } from "./routes/ping";
import { me, users } from "./routes/users";
import { hr } from "./routes/hr";
import { recruitment } from "./routes/recruitment";
import { sales } from "./routes/sales";
import { reports } from "./routes/reports";
import { campaigns } from "./routes/campaigns";
import { agenda } from "./routes/agenda";
import { d2d } from "./routes/d2d";

export const router = {
  ping,
  me,
  users,
  hr,
  recruitment,
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
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export default app;
