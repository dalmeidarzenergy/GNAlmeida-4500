// Backend portátil (Web Standard: Request -> Response). Catálogo de campanhas partilhado. NÃO depende da Vercel.
// GET  /api/campanhas  -> devolve o catálogo (público)
// POST /api/campanhas  -> grava o catálogo (só com o cabeçalho x-admin-key igual a ADMIN_KEY)
//
// ARMAZENAMENTO: usa a base de dados do próprio site (recomendado). Passa um "store" com duas funções:
//   const store = { get: async () => /* devolve o texto JSON guardado ou null */, set: async (texto) => /* guarda o texto JSON */ };
//   handle(request, process.env, store)
// Se não passares store, usa Upstash Redis por REST (variáveis UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN).
//
// Como ligar (adapta ao framework do site; o endereço TEM de ser /api/campanhas e aceitar GET, POST e OPTIONS):
//   Hono:    app.all('/api/campanhas', c => handle(c.req.raw, process.env, store));
//   Next.js: export const GET = POST = OPTIONS = (req) => handle(req, process.env, store);
const KEY = 'rz_catalogo', SEGS = ['lr', 'ln', 'lc', 'gr', 'gn'];
const hits = new Map();
const limited = ip => { const now = Date.now(), w = (hits.get(ip) || []).filter(t => now - t < 600000); w.push(now); hits.set(ip, w); return w.length > 20; };
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function handle(req, env = (typeof process !== 'undefined' ? process.env : {}), store = null) {
  const URL_ = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, TOK = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!store && URL_ && TOK) {
    const cmd = async c => { const r = await fetch(URL_, { method: 'POST', headers: { authorization: 'Bearer ' + TOK, 'content-type': 'application/json' }, body: JSON.stringify(c) }); if (!r.ok) throw new Error('redis ' + r.status); return (await r.json()).result; };
    store = { get: () => cmd(['GET', KEY]), set: t => cmd(['SET', KEY, t]) };
  }
  const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  const cors = { vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, x-admin-key' };
  if (ORIGINS.length && ORIGINS.includes(origin)) cors['access-control-allow-origin'] = origin;
  const J = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!store) return J(503, { error: 'armazenamento não configurado' });
  try {
    if (req.method === 'GET') {
      const v = await store.get();
      if (!v) return J(404, { error: 'sem catálogo' });
      return J(200, typeof v === 'string' ? JSON.parse(v) : v);
    }
    if (req.method === 'POST') {
      if (ORIGINS.length && origin && !ORIGINS.includes(origin)) return J(403, { error: 'origem não permitida' });
      const ip = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
      if (limited(ip)) return J(429, { error: 'demasiados pedidos' });
      if (!env.ADMIN_KEY || !same(req.headers.get('x-admin-key') || '', env.ADMIN_KEY)) return J(401, { error: 'não autorizado' });
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== 'object') return J(400, { error: 'pedido inválido' });
      const out = { atualizado: /^\d{4}-\d{2}-\d{2}$/.test(b.atualizado || '') ? b.atualizado : new Date().toISOString().slice(0, 10) };
      for (const k of SEGS) { if (!Array.isArray(b[k]) || b[k].length > 60) return J(400, { error: 'catálogo inválido' }); out[k] = b[k]; }
      const txt = JSON.stringify(out);
      if (txt.length > 400000) return J(413, { error: 'catálogo demasiado grande' });
      await store.set(txt);
      return J(200, { ok: true });
    }
    return J(405, { error: 'método não permitido' });
  } catch { return J(500, { error: 'falha no armazenamento' }); }
}
export default handle;
