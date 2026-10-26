import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { authed } from "../middleware/auth";
import { db } from "../database";
import { notifications } from "../database/schema";

export const notificationsRoute = {
  /** Notificações do utilizador autenticado (mais recentes primeiro). */
  list: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, context.user.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(100);
    const unread = rows.filter((r) => !r.read).length;
    return { items: rows, unread };
  }),
  /** Marca uma notificação como lida. */
  markRead: authed.input(z.object({ id: z.number() })).handler(async ({ input, context }) => {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, input.id));
    return { ok: true };
  }),
  /** Marca todas como lidas. */
  markAllRead: authed.handler(async ({ context }) => {
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, context.user.id));
    return { ok: true };
  }),
};
