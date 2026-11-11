import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Search, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { orpc } from "../lib/api";
import { useMe } from "../queries/me";
import { PageHeader, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pagination, ConfirmDelete } from "../components/ui/kit";
import { errMsg } from "../lib/format";

const SEGMENTS = [
  { key: "lr", label: "Luz – Residencial" },
  { key: "ln", label: "Luz – Negócios" },
  { key: "lc", label: "Luz – Condomínios" },
  { key: "gr", label: "Gás – Residencial" },
  { key: "gn", label: "Gás – Negócios" },
] as const;
type Seg = (typeof SEGMENTS)[number]["key"];

const POT = ["1,15", "2,3", "3,45", "4,6", "5,75", "6,9", "10,35", "13,8", "17,25", "20,7"];
const ESC = ["1", "2", "3", "4"];
const PAGE_SIZE = 20;

/** Converte o que o utilizador escreve ("0,1234") no número do catálogo. */
const toNum = (s: string) => {
  const t = String(s).trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
/** Mostra o número com vírgula decimal (formato pt-PT), sem zeros à direita. */
const show = (n: unknown) => (typeof n === "number" && n !== 0 ? String(n).replace(".", ",") : "");

export default function CatalogoSimuladorPage() {
  const me = useMe();
  const qc = useQueryClient();
  const list = useQuery(orpc.simuladorCatalogo.list.queryOptions());
  const [tab, setTab] = useState<Seg>("lr");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const write = me.data?.permissions?.["catalogo-simulador"]?.edit ?? false;
  const rows = list.data ?? [];

  const inTab = rows.filter((r) => r.seg === tab);
  const filtered = inTab.filter((r) => !q || `${r.n} ${r.r}`.toLowerCase().includes(q.toLowerCase()));
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pendentes = rows.filter((r) => !r.preenchido).length;

  const remove = useMutation({
    ...orpc.simuladorCatalogo.remove.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.simuladorCatalogo.key() }),
  });

  return (
    <div>
      <PageHeader eyebrow="Definições" title="Catálogo do simulador">
        <span className="text-[12.5px] text-ink-3">Preços dos planos que o simulador Iberdrola mostra.</span>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat delay={0} label="Planos no catálogo" value={rows.length} accent="var(--volt)" sub="em todos os segmentos" />
        <Stat delay={40} label="Por preencher" value={pendentes} accent="var(--amber)" sub="não aparecem no simulador" />
        <Stat delay={80} label="Com preços" value={rows.length - pendentes} accent="var(--sky)" sub="ativos na comparação" />
        <Stat delay={120} label="Neste segmento" value={inTab.length} accent="var(--rose)" sub="planos listados" />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: rows.filter((r) => r.seg === s.key).length }))} />
        <div className="ml-auto min-w-0"><SearchBox value={q} onChange={setQ} placeholder="Nome ou código do plano…" /></div>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading ? (
          <TableSkeleton cols={5} />
        ) : list.isError ? (
          <Empty title="Não foi possível carregar" text={errMsg(list.error)} />
        ) : !filtered.length ? (
          <Empty title="Sem planos neste segmento" text={rows.length ? "Nenhum plano corresponde ao filtro." : "O catálogo do simulador está vazio."} />
        ) : (
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th>Código</th>
                  <th>Estado</th>
                  <th>Válido até</th>
                  <th className="w-[90px]"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.seg + r.r} onClick={() => write && setEdit(r.r)} className={write ? "cursor-pointer" : ""}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{r.n || "—"}</span>
                        {r.bd > 0 && <span className="shrink-0 rounded-full bg-volt/10 px-2 py-[1px] text-[11px] font-medium text-volt">−{r.bd}%</span>}
                        {r.svc && <span className="shrink-0 rounded-full bg-sky/10 px-2 py-[1px] text-[11px] font-medium text-sky">serviço</span>}
                      </div>
                    </td>
                    <td className="num text-[12.5px] text-ink-2">{r.r}</td>
                    <td>
                      {r.preenchido ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-volt"><CheckCircle2 size={13} /> Com preços</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-amber"><AlertTriangle size={13} /> Por preencher</span>
                      )}
                    </td>
                    <td className="text-[12.5px] text-ink-3">{r.val ? r.val.split("-").reverse().join("/") : "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {write && <button className="btn-icon" aria-label="Editar" onClick={() => setEdit(r.r)}><Pencil size={14} /></button>}
                        {write && <button className="btn-icon text-danger" aria-label="Eliminar" onClick={() => setToDelete(r.r)}><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > PAGE_SIZE && <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>

      {edit && <PlanForm code={edit} onClose={() => setEdit(null)} />}

      <ConfirmDelete
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        pending={remove.isPending}
        error={remove.error ? errMsg(remove.error) : null}
        title="Eliminar plano"
        text={`O plano ${toDelete ?? ""} deixa de aparecer no simulador.`}
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync({ r: toDelete });
          setToDelete(null);
        }}
      />
    </div>
  );
}

/** Formulário de preços de um plano (luz: potência + energia; gás: fixo + escalões). */
function PlanForm({ code, onClose }: { code: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery(orpc.simuladorCatalogo.get.queryOptions({ input: { r: code } }));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    ...orpc.simuladorCatalogo.save.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orpc.simuladorCatalogo.key() });
      onClose();
    },
  });

  // Estado do formulário, preenchido quando o plano chega.
  const [f, setF] = useState<Record<string, string> | null>(null);
  const plan = detail.data?.plan as Record<string, any> | undefined;
  const seg = (detail.data?.seg ?? "lr") as Seg;
  const isGas = seg === "gr" || seg === "gn";

  useMemo(() => {
    if (!plan || f) return;
    const next: Record<string, string> = {
      n: String(plan.n ?? ""),
      r: String(plan.r ?? ""),
      f: String(plan.f ?? " Sem fidelização".trim()),
      t: String(plan.t ?? ""),
      bd: plan.bd ? String(plan.bd) : "",
      svc: plan.svc ? "1" : "",
      ini: String(plan.ini ?? ""),
      val: String(plan.val ?? ""),
    };
    for (const k of ["s", "fv", "v", "ex", "base", "q"]) next[k] = show(plan[k]);
    POT.forEach((_, i) => { next[`fx${i}`] = show(Array.isArray(plan.fx) ? plan.fx[i] : undefined); });
    ESC.forEach((_, i) => {
      next[`gf${i}`] = show(Array.isArray(plan.gf) ? plan.gf[i] : undefined);
      next[`ge${i}`] = show(Array.isArray(plan.ge) ? plan.ge[i] : undefined);
    });
    setF(next);
  }, [plan, f]);

  const set = (k: string, v: string) => setF((p) => ({ ...(p ?? {}), [k]: v }));

  return (
    <Modal open onClose={onClose} title={plan ? `Preços — ${plan.n || code}` : "A carregar…"} wide>
      {detail.isLoading || !f ? (
        <TableSkeleton rows={6} cols={2} />
      ) : detail.isError ? (
        <Empty title="Não foi possível carregar o plano" text={errMsg(detail.error)} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!f) return;
            setError(null);
            const payload: Record<string, unknown> = {
              seg,
              r: code,
              n: f.n || null,
              f: f.f || null,
              t: f.t || null,
              bd: toNum(f.bd) ?? 0,
              svc: f.svc === "1",
              ini: f.ini || null,
              val: f.val || null,
            };
            if (isGas) {
              payload.gf = ESC.map((_, i) => toNum(f[`gf${i}`]) ?? 0);
              payload.ge = ESC.map((_, i) => toNum(f[`ge${i}`]) ?? 0);
            } else {
              payload.fx = POT.map((_, i) => toNum(f[`fx${i}`]) ?? 0);
            }
            for (const k of ["s", "fv", "v", "ex", "base", "q"]) {
              const n = toNum(f[k]);
              if (n !== undefined) payload[k] = n;
            }
            try {
              await save.mutateAsync(payload as never);
            } catch (err) {
              setError(errMsg(err));
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do plano"><input className="input" value={f.n} onChange={(e) => set("n", e.target.value)} /></Field>
            <Field label="Código"><input className="input num uppercase" value={f.r} disabled /></Field>
            <Field label="Fidelização"><input className="input" value={f.f} placeholder="ex.: 12 meses" onChange={(e) => set("f", e.target.value)} /></Field>
            <Field label="Desconto base (%)"><input className="input num" value={f.bd} placeholder="ex.: 16" onChange={(e) => set("bd", e.target.value)} /></Field>
            <Field label="Início (opcional)"><input className="input" type="date" value={f.ini} onChange={(e) => set("ini", e.target.value)} /></Field>
            <Field label="Válido até"><input className="input" type="date" value={f.val} onChange={(e) => set("val", e.target.value)} /></Field>
            <Field label="Nota mostrada no simulador" className="sm:col-span-2"><input className="input" value={f.t} placeholder="opcional" onChange={(e) => set("t", e.target.value)} /></Field>
          </div>

          <label className="mt-4 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={f.svc === "1"} onChange={(e) => set("svc", e.target.checked ? "1" : "")} />
            <span>Dá 2% extra a quem aderir a um serviço de proteção (PEL / MGI)</span>
          </label>

          {isGas ? (
            <div className="mt-6">
              <h4 className="mb-1 text-[13px] font-semibold">Termo fixo (€/dia, sem desconto)</h4>
              <p className="mb-3 text-[12px] text-ink-3">Escalões 1 a 4 de consumo de gás.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ESC.map((lbl, i) => (
                  <Field key={lbl} label={`Escalão ${lbl}`}>
                    <input className="input num" inputMode="decimal" value={f[`gf${i}`]} onChange={(e) => set(`gf${i}`, e.target.value)} />
                  </Field>
                ))}
              </div>
              <h4 className="mb-1 mt-5 text-[13px] font-semibold">Energia (€/kWh, sem desconto)</h4>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ESC.map((lbl, i) => (
                  <Field key={lbl} label={`Escalão ${lbl}`}>
                    <input className="input num" inputMode="decimal" value={f[`ge${i}`]} onChange={(e) => set(`ge${i}`, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <h4 className="mb-1 text-[13px] font-semibold">Potência contratada (€/dia, sem desconto)</h4>
              <p className="mb-3 text-[12px] text-ink-3">Uma coluna por potência. Deixe vazio as que o plano não tem.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {POT.map((lbl, i) => (
                  <Field key={lbl} label={`${lbl} kVA`}>
                    <input className="input num" inputMode="decimal" value={f[`fx${i}`]} onChange={(e) => set(`fx${i}`, e.target.value)} />
                  </Field>
                ))}
              </div>
              <h4 className="mb-3 mt-5 text-[13px] font-semibold">Energia (€/kWh, sem desconto)</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Simples"><input className="input num" inputMode="decimal" value={f.s} onChange={(e) => set("s", e.target.value)} /></Field>
                <Field label="Fora de vazio"><input className="input num" inputMode="decimal" value={f.fv} onChange={(e) => set("fv", e.target.value)} /></Field>
                <Field label="Vazio"><input className="input num" inputMode="decimal" value={f.v} onChange={(e) => set("v", e.target.value)} /></Field>
                <Field label="Exclusivo (Poupança)"><input className="input num" inputMode="decimal" value={f.ex} onChange={(e) => set("ex", e.target.value)} /></Field>
                <Field label="Base (Poupança)"><input className="input num" inputMode="decimal" value={f.base} onChange={(e) => set("base", e.target.value)} /></Field>
                <Field label="Componente Q (Indexado)"><input className="input num" inputMode="decimal" value={f.q} onChange={(e) => set("q", e.target.value)} /></Field>
              </div>
            </div>
          )}

          <SubmitRow pending={save.isPending} onCancel={onClose} error={error} />
        </form>
      )}
    </Modal>
  );
}
