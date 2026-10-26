/**
 * Job de alertas (Vendas Críticas + Estado VTV).
 *
 * Corre 2x por dia (manhã e tarde) e, por cada comercial com vendas por tratar
 * (contratação em até 3 dias ou Estado VTV não-OK), cria uma notificação interna
 * e imprime em stdout a lista de destinatários para o email correspondente.
 *
 * Respeita o interruptor `sales.alerts_disabled` (vendas silenciadas por
 * admin/diretor/backoffice). Deduplica por slot (data-manha / data-tarde).
 *
 * Correr com o `.env` carregado (DATABASE_URL). Ex.:
 *   bun run --env-file=../../.env scripts/alerts.ts
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DEADLINE_DAYS = 3;
const PRE_CONTROL = new Set(["Prospeção", "Pré-Venda", "Backoffice"]);

function lisbonNow() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Lisbon" });
  return { date: s.slice(0, 10), hour: Number(s.slice(11, 13)) };
}

function dbPath() {
  const url = (process.env.DATABASE_URL ?? "file:src/data.db").trim();
  if (url.startsWith("file:")) return resolve(import.meta.dir, "..", url.slice("file:".length));
  // Remoto (libsql/Turso) — este job desenhado para o SQLite local; devolve o caminho para erro claro.
  return url;
}

type Sale = {
  id: number;
  number: string;
  clientName: string | null;
  sellerId: number | null;
  sellerName: string | null;
  sellerEmail: string | null;
  date: string;
  status: string;
  service: string | null;
  vtvStatus: string | null;
  vtvStatusGas: string | null;
  alertsDisabled: number;
  ctrlOn: string | null;
};

const DAY = 86400000;
const daysSince = (date: string, today: string) => Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / DAY);

const isKO = (s: string | null) => !!s && s.startsWith("KO-");
const isGrave = (s: string | null) => !!s && (s.startsWith("KO-A") || s.startsWith("KO-B"));
const isDone = (status: string) => status === "Control" || status === "Anulado";

function main() {
  const path = dbPath();
  if (!path.endsWith(".db")) {
    console.error("DATABASE_URL aponta para um destino remoto; o job assume SQLite local (file:).");
    process.exit(1);
  }
  const db = new Database(path, { readonly: true });

  const { date: today, hour } = lisbonNow();
  const slot = `${today}-${hour < 14 ? "manha" : "tarde"}`;

  const rows = db
    .query(`
      SELECT
        s.id, s.number, s.date, s.status, s.service,
        s.seller_id AS sellerId,
        s.alerts_disabled AS alertsDisabled,
        json_extract(s.details, '$.vtvStatus') AS vtvStatus,
        json_extract(s.details, '$.vtvStatusGas') AS vtvStatusGas,
        c.name AS clientName,
        e.name AS sellerName,
        e.email AS sellerEmail,
        (SELECT min(h.changed_on) FROM sale_status_history h
          WHERE h.sale_id = s.id AND h.energy = 'luz' AND h.status = 'Control') AS ctrlOn
      FROM sales s
      LEFT JOIN clients c ON c.id = s.client_id
      LEFT JOIN employees e ON e.id = s.seller_id
    `)
    .all() as Sale[];

  db.close();

  // Por comercial: vendas por tratar.
  type Item = { number: string; client: string; kind: string; days: number };
  const bySeller = new Map<number, { name: string | null; email: string | null; items: Item[]; grave: boolean }>();

  for (const s of rows) {
    if (s.sellerId == null) continue;
    // Só vendas do mês corrente; as de meses anteriores não geram alertas.
    if ((s.date ?? "").slice(0, 7) !== today.slice(0, 7)) continue;
    const items: Item[] = [];
    let grave = false;

    // 1) Contratação: ainda pré-Control (por tratar).
    if (PRE_CONTROL.has(s.status)) {
      const d = daysSince(s.date, today);
      items.push({ number: s.number, client: s.clientName ?? "?", kind: d > DEADLINE_DAYS ? "fora-do-prazo" : "por-contratar", days: d });
    } else if (!isDone(s.status) && s.ctrlOn && daysSince(s.date, s.ctrlOn) > DEADLINE_DAYS) {
      // Já em Control mas demorou mais de 3 dias — fica registado como crítico.
      items.push({ number: s.number, client: s.clientName ?? "?", kind: "contratacao-lenta", days: daysSince(s.date, s.ctrlOn) });
    }

    // 2) Estado VTV não-OK.
    const entries = [s.vtvStatus, s.vtvStatusGas].filter((v): v is string => !!v);
    const hasKO = entries.some(isKO);
    const hasPendente = entries.some((v) => v === "Pendente");
    const graveVtv = entries.some(isGrave);
    const vtvRelevant = (graveVtv ? true : !isDone(s.status)) && (hasKO || hasPendente);
    if (vtvRelevant) {
      items.push({ number: s.number, client: s.clientName ?? "?", kind: graveVtv ? "vtv-grave" : hasKO ? "vtv-ko" : "vtv-pendente", days: daysSince(s.date, today) });
      if (graveVtv) grave = true;
    }

    if (s.alertsDisabled) continue; // venda silenciada
    if (!items.length) continue;

    const bucket = bySeller.get(s.sellerId) ?? { name: s.sellerName, email: s.sellerEmail, items: [], grave: false };
    bucket.items.push(...items);
    if (grave) bucket.grave = true;
    bySeller.set(s.sellerId, bucket);
  }

  // Ligações comercial -> utilizador (conta) via user_roles.employee_id.
  const db2 = new Database(path, { readonly: true });
  const userRows = db2.query(`SELECT ur.user_id AS userId, ur.employee_id AS empId, u.email AS email, u.name AS userName FROM user_roles ur LEFT JOIN user u ON u.id = ur.user_id WHERE ur.employee_id IS NOT NULL`).all() as { userId: string; empId: number; email: string; userName: string }[];
  db2.close();
  const usersByEmp = new Map<number, { userId: string; email: string; name: string }[]>();
  for (const u of userRows) {
    const l = usersByEmp.get(u.empId) ?? [];
    l.push({ userId: u.userId, email: u.email, name: u.userName });
    usersByEmp.set(u.empId, l);
  }

  // Escreve notificações (deduplicadas por slot).
  const db3 = new Database(path);
  const existsStmt = db3.query(`SELECT id FROM notifications WHERE slot = ? AND user_id = ?`);
  const insert = db3.prepare(`INSERT INTO notifications (user_id, title, body, url, type, slot, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
  const nowMs = Date.now();

  const emails: { to: string; subject: string; body: string }[] = [];

  for (const [empId, bucket] of bySeller) {
    const users = usersByEmp.get(empId) ?? [];
    if (!users.length) continue;

    const porContratar = bucket.items.filter((i) => i.kind === "por-contratar").length;
    const foraPrazo = bucket.items.filter((i) => i.kind === "fora-do-prazo").length;
    const vtvKO = bucket.items.filter((i) => i.kind === "vtv-ko" || i.kind === "vtv-grave").length;
    const vtvPendente = bucket.items.filter((i) => i.kind === "vtv-pendente").length;

    const title = bucket.grave ? "⚠️ Vendas com KO-A / KO-B para tratar" : `${bucket.items.length} ${bucket.items.length === 1 ? "venda" : "vendas"} por tratar`;
    const parts: string[] = [];
    if (porContratar) parts.push(`${porContratar} por contratar`);
    if (foraPrazo) parts.push(`${foraPrazo} fora do prazo (${foraPrazo * 10}€)`);
    if (vtvKO) parts.push(`${vtvKO} estado VTV KO`);
    if (vtvPendente) parts.push(`${vtvPendente} estado VTV pendente`);
    const body = parts.join(" · ") || "Vendas a precisar de atenção";
    const url = vtvKO || vtvPendente ? "/estado-vtv" : "/vendas-criticas";

    const itemLines = bucket.items.slice(0, 8).map((i) => `  • ${i.number} — ${i.client} (${i.kind === "por-contratar" ? `${i.days}d / ${DEADLINE_DAYS}d` : i.kind})`).join("\n");

    for (const u of users) {
      if (existsStmt.get(slot, u.userId)) continue;
      insert.run(u.userId, title, `${body}\n${bucket.items.length > 8 ? `+ ${bucket.items.length - 8} outras\n` : ""}`, url, bucket.grave ? "estado-vtv" : "vendas-criticas", slot, nowMs);
      if (u.email) {
        emails.push({
          to: u.email,
          subject: title,
          body: `Olá ${bucket.name ?? u.name ?? ""},\n\nTens estas vendas por tratar:\n${itemLines}${bucket.items.length > 8 ? `\n+ ${bucket.items.length - 8} outras` : ""}\n\nResumo: ${body}.\nConfirma no painel: ${url === "/estado-vtv" ? "Estado VTV" : "Vendas Críticas"}.`,
        });
      }
    }
  }
  db3.close();

  // Saída para o agente agendado enviar os emails (JSON no stdout).
  console.log(JSON.stringify({ slot, emails }, null, 2));
}

main();
