import { useEffect, useMemo, useState } from "react";
import { Plus, Phone, Search } from "lucide-react";
import { Link } from "wouter";
import { useOrders, useSaveSale } from "../queries/sales";
import { useClients } from "../queries/sales";
import { useEmployeeOptions } from "../queries/hr";
import { useMe } from "../queries/me";
import { PageHeader, SearchBox, Empty, TableSkeleton, Stat, Pill, Pagination, Field, SubmitRow } from "../components/ui/kit";
import { W2L_STATUS, W2L_ESCOLAS, SUPPLIER } from "../../api/shared/client-forms";
import { errMsg, fmtDate } from "../lib/format";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

const PAGE_SIZE = 20;

export default function W2lPage() {
  const me = useMe();
  const orders = useOrders();
  const clients = useClients();
  const emps = useEmployeeOptions();
  const save = useSaveSale();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New W2L form state
  const [escola, setEscola] = useState<string>("Luz");
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [contacto, setContacto] = useState("");
  const [callDate, setCallDate] = useState("");
  const [gestorId, setGestorId] = useState<number | null>(null);
  const [known, setKnown] = useState<string | null>(null);

  const role = me.data?.role ?? "";
  const isAdmin = role === "admin" || role === "diretor" || role === "backoffice";
  const managers = (emps.data ?? []).filter((x) => x.status !== "inativo");

  const w2lSales = useMemo(
    () => (orders.data ?? []).filter((o) => o.details?.w2l === true),
    [orders.data],
  );

  const list = useMemo(() => {
    const s = q.toLowerCase();
    return w2lSales.filter(
      ({ number, clientName, sellerName, details }) =>
        !s ||
        number.toLowerCase().includes(s) ||
        clientName.toLowerCase().includes(s) ||
        (sellerName ?? "").toLowerCase().includes(s) ||
        (typeof details?.leedNumber === "string" && details.leedNumber.toLowerCase().includes(s)) ||
        (typeof details?.nif === "string" && details.nif.toLowerCase().includes(s)),
    );
  }, [w2lSales, q]);

  useEffect(() => setPage(1), [q]);
  const paged = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Auto-fill when NIF changes
  useEffect(() => {
    if (/^\d{9}$/.test(nif)) {
      const c = clients.data?.find((x) => x.nif === nif);
      if (c) {
        setNome(c.name);
        setContacto(c.phone ?? "");
        if (c.ownerId && !gestorId) setGestorId(c.ownerId);
        setKnown(c.name);
      } else setKnown(null);
    } else setKnown(null);
  }, [nif]);

  const handleCreate = async () => {
    setError(null);
    if (!nome.trim()) return setError("Preencha o nome do cliente.");
    if (!/^\d{9}$/.test(nif)) return setError("NIF inválido (9 dígitos).");
    try {
      await save.create.mutateAsync({
        service: escola,
        details: {
          name: nome.trim(),
          nif,
          contact: contacto.trim(),
          w2l: true,
          leedStatus: "Em Processamento",
          w2lCallDate: callDate || null,
        } as any,
        ownerId: gestorId,
      });
      setShowNew(false);
      setNome(""); setNif(""); setContacto(""); setCallDate(""); setGestorId(null); setKnown(null);
    } catch (err) { setError(errMsg(err)); }
  };

  if (orders.error) {
    return (
      <div>
        <PageHeader eyebrow="Vendas" title="W2L" />
        <div className="card"><Empty title="Sem acesso" text={errMsg(orders.error)} /></div>
      </div>
    );
  }

  const pendentes = w2lSales.filter((o) => o.details?.leedStatus === "Pendente" || o.details?.leedStatus === "Em Processamento");
  const consentidas = w2lSales.filter((o) => o.details?.leedStatus === "Consentida");

  return (
    <div>
      <PageHeader
        eyebrow="Vendas"
        title="W2L"
        subtitle="Gestão de Leed W2L — leads e contactos. Cada entrada representa uma venda associada ao programa W2L."
      >
        <div className="flex items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Nº leed, cliente, vendedor…" />
          <button type="button" className="btn btn-primary h-10 gap-2" onClick={() => setShowNew(true)}>
            <Plus size={16} /> Nova W2L
          </button>
        </div>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat delay={0} label="Total W2L" value={w2lSales.length} accent="var(--volt)" sub="entradas registadas" />
        <Stat delay={40} label="Em Aberto" value={pendentes.length} accent="var(--amber)" sub="Em Processamento ou Pendente" />
        <Stat delay={80} label="Consentidas" value={consentidas.length} accent="var(--ok)" />
      </div>

      {/* New W2L inline form */}
      {showNew && (
        <div className="mb-5 card">
          <h3 className="mb-1 font-display text-[15px] font-semibold">Nova Entrada W2L</h3>
          <p className="mb-4 text-[12.5px] text-ink-3">Cria uma lead W2L. O NIF preenche os dados automaticamente se o cliente já existir.</p>
          {known && <p className="mb-3 rounded-[10px] border border-line bg-bg px-3 py-2 text-[12px] text-ink-2">Cliente já registado: <strong className="text-ink">{known}</strong>.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Escola *">
              <select className="input" value={escola} onChange={(e) => setEscola(e.target.value)}>
                {W2L_ESCOLAS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="NIF *">
              <input className="input num" value={nif} onChange={(e) => setNif(e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="9 dígitos" />
            </Field>
            <Field label="Nome do Cliente *" className="sm:col-span-2">
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
            </Field>
            <Field label="Contacto">
              <input className="input num" value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="912345678" />
            </Field>
            <Field label="Data para a Chamada">
              <input type="date" className="input" value={callDate} onChange={(e) => setCallDate(e.target.value)} />
            </Field>
            <Field label="Gestor de Cliente" className="sm:col-span-2">
              <select className="input" value={gestorId ?? ""} onChange={(e) => setGestorId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Selecione o gestor…</option>
                {managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
          <SubmitRow pending={save.isPending} onCancel={() => { setShowNew(false); setError(null); }} error={error} label="Criar W2L" />
        </div>
      )}

      <div className="card overflow-hidden">
        {orders.isLoading ? (
          <TableSkeleton cols={9} />
        ) : !list.length ? (
          <Empty title="Nenhuma W2L" text={q ? "Nenhum resultado para esta pesquisa." : "Ainda não há entradas W2L. Clica em \"Nova W2L\" para começar."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Nº Leed</th>
                  <th>Escola</th>
                  <th>Cliente</th>
                  <th>Contacto</th>
                  <th>Data Chamada</th>
                  <th>Gestor</th>
                  <th>Estado Leed</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr key={o.id}>
                    <td className="num text-[12.5px] text-ink-2">{o.number}</td>
                    <td className="num text-[12.5px] text-ink-2">{(o.details?.leedNumber as string) || "—"}</td>
                    <td className="text-ink-2">{o.service ?? "—"}</td>
                    <td>
                      <div className="font-medium">{o.clientName}</div>
                      {o.clientNif && <div className="num text-[11px] text-ink-3">{o.clientNif}</div>}
                    </td>
                    <td className="num text-ink-2">{o.clientPhone || "—"}</td>
                    <td className="num text-[12.5px] text-ink-2">{(o.details?.w2lCallDate as string) || "—"}</td>
                    <td className="text-ink-2">{o.sellerName ?? "—"}</td>
                    <td>
                      <Pill color={
                        o.details?.leedStatus === "Consentida" ? "var(--ok)" :
                        o.details?.leedStatus === "Pendente" ? "var(--amber)" :
                        o.details?.leedStatus === "Em Assinatura" ? "var(--volt)" :
                        "var(--ink-2)"
                      }>
                        {(o.details?.leedStatus as string) || "—"}
                      </Pill>
                    </td>
                    <td className="w-24 whitespace-nowrap">
                      <Link href={`/venda/${o.id}?from=/w2l`} className="btn btn-ghost h-8 text-[12px]">Abrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={list.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}