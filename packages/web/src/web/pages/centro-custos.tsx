/**
 * Página "Centro de Custos": o dinheiro da empresa num mês.
 *
 * Cinco abas, pela ordem em que o dinheiro se decide:
 *  - Previsão Auto  — cálculo das vendas do CRM (antes de chegar o Excel da Iberdrola)
 *  - Auto Final     — valores do ficheiro da Iberdrola já carregado para o mês
 *  - Despesas Empresa — massa salarial + frota + despesas lançadas à mão
 *  - Comissões      — o que está registado a pagar aos comerciais
 *  - Lucro da Empresa — Auto Final (o que a Iberdrola paga) − comissões − despesas
 *
 * A previsão e o auto final são exatamente os mesmos cálculos da Previsão de
 * Pagamentos e dos Autos Finais: aqui só se somam por rubrica.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Wallet,
  Users,
  TrendingUp,
  TrendingDown,
  Fuel,
  Plus,
  Pencil,
  Trash2,
  Calculator,
  FileCheck2,
  Receipt,
  HandCoins,
  PiggyBank,
  Search,
  Table2,
  Check,
} from "lucide-react";
import { PageHeader, Stat, Empty, Tabs, Modal, Field, SubmitRow, Pill, ConfirmDelete } from "../components/ui/kit";
import {
  useCompanyFinance,
  useCompanyExpenses,
  useSaveCompanyExpense,
  useRemoveCompanyExpense,
  useCompanyCommissionTable,
  useSetCompanyCommissionTable,
} from "../queries/company";
import { useCommissionTables } from "../queries/commission-tables";
import { fmtEur, fmtEur2, monthLabel, errMsg } from "../lib/format";

type TabKey = "previsao" | "final" | "despesas" | "comissoes" | "lucro";

function pad(v: number) {
  return v < 10 ? "0" + v : "" + v;
}

function todayLisbon() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function parseYM(ym: string) {
  const [yy, mm] = ym.split("-");
  return { y: Number(yy), m: Number(mm) };
}

/** Mês ym recuado de n meses ("2026-11", 1 -> "2026-10"). */
function monthsAgo(ym: string, n: number) {
  const { y, m } = parseYM(ym);
  const d = new Date(y, m - 1 - n, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}

/** Janela rolante de meses, do mais recente para o mais antigo. */
function monthOptions(count: number) {
  const now = todayLisbon().slice(0, 7);
  const { y, m } = parseYM(now);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(d.getFullYear() + "-" + pad(d.getMonth() + 1));
  }
  return out;
}

/** Categorias das despesas lançadas à mão (igual ao servidor). */
const CATEGORIES = [
  { key: "rendas", label: "Rendas" },
  { key: "software", label: "Software" },
  { key: "marketing", label: "Marketing" },
  { key: "servicos", label: "Serviços" },
  { key: "impostos", label: "Impostos" },
  { key: "outros", label: "Outros" },
] as const;

type Category = (typeof CATEGORIES)[number]["key"];

const categoryLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

/** Linha de uma conta (rubrica + valor), como no fim de um extrato. */
function ContaRow({ label, value, note, strong, tone }: { label: string; value: string; note?: string; strong?: boolean; tone?: string }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className={`px-4 py-2.5 ${strong ? "font-semibold" : "text-ink-2"}`}>
        {label}
        {note && <div className="text-[11.5px] font-normal text-ink-3">{note}</div>}
      </td>
      <td className={`num px-4 py-2.5 text-right ${strong ? "font-semibold" : "text-ink-2"}`} style={tone ? { color: tone } : undefined}>
        {value}
      </td>
    </tr>
  );
}

export default function CentroCustosPage() {
  const months = useMemo(() => monthOptions(24), []);
  const [month, setMonth] = useState(() => todayLisbon().slice(0, 7));
  const [tab, setTab] = useState<TabKey>("previsao");
  const finance = useCompanyFinance(month);
  const data = finance.data;
  const [openTable, setOpenTable] = useState(false);

  const f = data?.forecast;
  const fin = data?.final;
  const exp = data?.expenses;
  const com = data?.commissions;
  const lucro = data?.profit;

  const loading = finance.isLoading && !data;

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Centro de Custos"
        subtitle="O que entra e o que sai na empresa em cada mês: previsão e auto final da Iberdrola, despesas, comissões e o lucro que fica."
      />

      <div className="card rise mb-4 flex flex-wrap items-end gap-3 p-4" style={{ animationDelay: "0ms" }}>
        <label className="flex flex-col gap-1">
          <span className="label-mono">Mês de referência</span>
          <select className="input w-52" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês de referência">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === todayLisbon().slice(0, 7) ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto pb-1">
          <span className="label-mono mb-1 block">Tabela aplicada</span>
          <button type="button" className="btn btn-ghost" onClick={() => setOpenTable(true)} aria-label="Tabela Comissão">
            <Table2 size={15} />
            Tabela Comissão
            <span className="ml-1 max-w-[190px] truncate text-ink-3">{data?.companyTable?.name ?? "por escolher"}</span>
          </button>
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: "previsao" as const, label: "Previsão Auto" },
              { key: "final" as const, label: "Auto Final" },
              { key: "despesas" as const, label: "Despesas Empresa" },
              { key: "comissoes" as const, label: "Comissões", count: com?.rows.filter((r) => r.registered > 0).length ?? 0 },
              { key: "lucro" as const, label: "Lucro da Empresa" },
            ]}
          />
        </div>
      </div>

      {data?.companyTable ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
          <Pill tone="volt">Tabela Comissão</Pill>
          <span>
            A previsão e o auto final usam a tabela <span className="font-semibold text-ink">{data.companyTable.name}</span> para todos os comerciais. O escalão sobe com o
            total de vendas da empresa no mês.
          </span>
          <button type="button" className="text-volt underline underline-offset-2 hover:no-underline" onClick={() => setOpenTable(true)}>
            mudar
          </button>
        </div>
      ) : null}

      <TabelaComissaoModal open={openTable} onClose={() => setOpenTable(false)} currentId={data?.companyTable?.id ?? null} month={month} />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[118px] rounded-[14px]" />
          ))}
        </div>
      ) : tab === "previsao" ? (
        <PrevisaoTab month={month} forecast={f} />
      ) : tab === "final" ? (
        <FinalTab month={month} finalData={fin} forecast={f} />
      ) : tab === "despesas" ? (
        <DespesasTab month={month} exp={exp} />
      ) : tab === "comissoes" ? (
        <ComissoesTab month={month} com={com} />
      ) : (
        <LucroTab month={month} lucro={lucro} exp={exp} fin={fin} forecast={f} />
      )}
    </>
  );
}

/* ------------------------------------------------------- tabela comissão da empresa */

/**
 * Escolha da tabela comissional que a empresa aplica na previsão e no auto final.
 * As vendas de todos os comerciais passam a valer os valores desta tabela — é a
 * mesma tabela que se preenche em Tabelas Comissionais.
 */
function TabelaComissaoModal({ open, onClose, currentId, month }: { open: boolean; onClose: () => void; currentId: number | null; month: string }) {
  const tables = useCommissionTables();
  const save = useSetCompanyCommissionTable();
  const [error, setError] = useState<string | null>(null);

  // Só as tabelas de vendas (RES+BTN NEG) pagam comissões; a Tabela Empresa é faturação interna.
  const options = (tables.data ?? []).filter((t) => t.regime === "RES+BTN NEG" && t.group !== "empresa");

  const choose = (tableId: number | null) => {
    setError(null);
    save.mutate(
      { tableId },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(errMsg(e)),
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Tabela Comissão" size="wide">
      <p className="mb-4 text-[12.5px] text-ink-2">
        Escolhe a tabela que a empresa aplica a partir de {monthLabel(month)}. A previsão e o auto final do Centro de Custos passam a valorizar as vendas de todos os
        comerciais por esta tabela, e o escalão sobe com o total de vendas da empresa. A escolha mantém-se até ser mudada e não altera a Previsão de Pagamentos nem o
        Auto Iberdrola.
      </p>

      {!options.length ? (
        <Empty
          title="Ainda não há tabelas de vendas"
          text="Cria uma tabela comercial (regime RES+BTN NEG) em Tabelas Comissionais e volta aqui para a aplicar à empresa."
          action={<Link to="/tabelas-comissionais" className="btn btn-ghost">Ir para Tabelas Comissionais</Link>}
        />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line">
          {options.map((t, i) => {
            const active = currentId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => choose(t.id)}
                disabled={save.isPending}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-surface-2/70 ${i > 0 ? "border-t border-line" : ""} ${active ? "bg-surface-2/60" : ""}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    {t.active ? "ativa" : "inativa"} · {t.clientRows.length} escalão(ões)
                    {t.blockedSales ? ` · ${t.blockedSales} venda(s) bloqueada(s)` : ""}
                    {t.description ? ` · ${t.description}` : ""}
                  </span>
                </span>
                {active ? <Check size={16} className="text-volt" /> : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-[12.5px] text-rose">{error}</div>
        <div className="flex gap-2">
          {currentId != null && (
            <button type="button" className="btn btn-ghost" onClick={() => choose(null)} disabled={save.isPending}>
              Cada comercial com a sua tabela
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ previsão */

type Finance = NonNullable<ReturnType<typeof useCompanyFinance>["data"]>;
type Person = { employeeId: number; employeeName: string; tableName: string | null; sales: number; gross: number; chargeback: number; due: number; medem?: number };

function PrevisaoTab({ month, forecast }: { month: string; forecast?: Finance["forecast"] }) {
  const people: Person[] = forecast?.people ?? [];
  const t = forecast?.totals ?? { gross: 0, chargeback: 0, due: 0, sales: 0, people: 0 };
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="A receber (previsto)" value={fmtEur(t.gross)} sub="o que a Iberdrola deve pagar pelas vendas do mês" icon={<Wallet size={15} />} accent="var(--volt)" delay={0} />
        <Stat label="Chargeback" value={fmtEur(t.chargeback)} sub="baixas descontadas no mês" icon={<TrendingDown size={15} />} accent="var(--rose)" delay={40} />
        <Stat label="A pagar aos comerciais" value={fmtEur(t.due)} sub={`${t.people} pessoa(s) com valores no mês`} icon={<HandCoins size={15} />} accent="var(--sky)" delay={80} />
        <Stat label="Vendas contadas" value={t.sales} sub={`em ${monthLabel(month)}`} icon={<TrendingUp size={15} />} accent="var(--amber)" delay={120} />
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        <div className="border-b border-line px-4 py-3">
          <div className="font-display text-[13px] font-semibold">Previsão por comercial</div>
          <div className="text-[11.5px] text-ink-3">Cálculo a partir das vendas registadas no CRM — antes de chegar o Excel da Iberdrola.</div>
        </div>
        {!people.length ? (
          <Empty
            title="Sem vendas a pagamento neste mês"
            text={`Não há vendas em fornecimento com tabela atribuída em ${monthLabel(month)}. A previsão aparece assim que houver vendas.`}
            action={<Link to="/pagamentos" className="btn btn-ghost">Ver Previsão de Pagamentos</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Pessoa</th>
                  <th className="label-mono px-4 py-3 font-normal">Tabela</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Vendas</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">A receber</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Chargeback</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">A pagar</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employeeId} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5 font-medium">{p.employeeName}</td>
                    <td className="px-4 py-2.5 text-ink-2">{p.tableName ?? <span className="text-ink-3">sem tabela</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{p.sales}</td>
                    <td className="num px-4 py-2.5 text-right">{fmtEur(p.gross)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{p.chargeback ? fmtEur(p.chargeback) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{fmtEur(p.due)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold" colSpan={2}>Total</td>
                  <td className="num px-4 py-3 text-right font-semibold">{t.sales}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(t.gross)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(t.chargeback)}</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur(t.due)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- auto final */

function FinalTab({ month, finalData, forecast }: { month: string; finalData?: Finance["final"]; forecast?: Finance["forecast"] }) {
  const people: Person[] = finalData?.people ?? [];
  const t = finalData?.totals ?? { gross: 0, chargeback: 0, due: 0, medem: 0, people: 0 };
  const previsto = forecast?.totals ?? { gross: 0, chargeback: 0, due: 0, sales: 0, people: 0 };
  const dif = (a: number, b: number) => Math.round((a - b) * 100) / 100;

  if (!finalData?.loaded) {
    return (
      <div className="card rise overflow-hidden">
        <Empty
          title={`Sem ficheiro da Iberdrola em ${monthLabel(month)}`}
          text="O auto final é calculado a partir do Excel da Iberdrola. Carrega o ficheiro do mês para esta aba passar a ter os valores finais."
          action={<Link to="/auto-iberdrola" className="btn btn-primary">Carregar ficheiro</Link>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="A receber" value={fmtEur(t.gross)} sub={`${t.people} comercial(is) no ficheiro`} icon={<Wallet size={15} />} accent="var(--volt)" delay={0} />
        <Stat label="Chargeback" value={fmtEur(t.chargeback)} sub="baixas descontadas" icon={<TrendingDown size={15} />} accent="var(--rose)" delay={40} />
        <Stat label="MEDEM" value={fmtEur(t.medem)} sub="pontos medidos no mês" icon={<Calculator size={15} />} accent="var(--amber)" delay={80} />
        <Stat label="A pagar aos comerciais" value={fmtEur(t.due)} sub="total do auto final" icon={<HandCoins size={15} />} accent="var(--sky)" delay={120} />
      </div>

      <div className="card mt-4 flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-[12.5px]">
        <span className="label-mono">Final vs previsão</span>
        <span className="text-ink-2">
          A receber: <span className={`num font-semibold ${dif(t.gross, previsto.gross) < 0 ? "text-rose" : "text-volt"}`}>{dif(t.gross, previsto.gross) > 0 ? "+" : ""}{fmtEur(dif(t.gross, previsto.gross))}</span>
        </span>
        <span className="text-ink-2">
          A pagar: <span className={`num font-semibold ${dif(t.due, previsto.due) < 0 ? "text-rose" : "text-volt"}`}>{dif(t.due, previsto.due) > 0 ? "+" : ""}{fmtEur(dif(t.due, previsto.due))}</span>
        </span>
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        <div className="border-b border-line px-4 py-3">
          <div className="font-display text-[13px] font-semibold">Auto final por comercial</div>
          <div className="text-[11.5px] text-ink-3">Valores do ficheiro da Iberdrola carregado para {monthLabel(month)}.</div>
        </div>
        {!people.length ? (
          <Empty title="O ficheiro não tem comerciais identificados" text="Confirma se o Excel tem a coluna do comercial ou do NIF do comercial preenchida." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Pessoa</th>
                  <th className="label-mono px-4 py-3 font-normal">Tabela</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Vendas</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">A receber</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Chargeback</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">MEDEM</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">A pagar</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employeeId} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5 font-medium">{p.employeeName}</td>
                    <td className="px-4 py-2.5 text-ink-2">{p.tableName ?? <span className="text-ink-3">sem tabela</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{p.sales}</td>
                    <td className="num px-4 py-2.5 text-right">{fmtEur(p.gross)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{p.chargeback ? fmtEur(p.chargeback) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{p.medem ? fmtEur(p.medem) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{fmtEur(p.due)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold" colSpan={3}>Total</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(t.gross)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(t.chargeback)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(t.medem)}</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur(t.due)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- despesas */

function DespesasTab({ month, exp }: { month: string; exp?: Finance["expenses"] }) {
  const expenses = useCompanyExpenses(month);
  const remove = useRemoveCompanyExpense();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Finance["expenses"]["rows"][number] | null>(null);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = exp?.rows ?? expenses.data?.rows ?? [];
    return s ? all.filter((r) => r.description.toLowerCase().includes(s) || categoryLabel(r.category).toLowerCase().includes(s)) : all;
  }, [exp, expenses.data, q]);

  const total = exp?.total ?? 0;
  const payroll = exp?.payroll ?? 0;
  const fleet = exp?.fleet ?? 0;
  const totalMes = exp?.monthTotal ?? payroll + fleet + total;
  const prev = exp?.previousTotal ?? 0;
  const before = exp?.previousMonth ? monthLabel(exp.previousMonth) : monthLabel(monthsAgo(month, 1));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Massa salarial" value={fmtEur(payroll)} sub="salário base das pessoas no mês" icon={<Users size={15} />} accent="var(--sky)" delay={0} />
        <Stat label="Frota" value={fmtEur(fleet)} sub="combustível, portagens e manutenções" icon={<Fuel size={15} />} accent="var(--rose)" delay={40} />
        <Stat label="Outras despesas" value={fmtEur(total)} sub={`${(exp?.rows ?? []).length} despesa(s) lançada(s) à mão`} icon={<Receipt size={15} />} accent="var(--amber)" delay={80} />
        <Stat
          label="Total do mês"
          value={fmtEur(totalMes)}
          sub={prev > 0 ? `${fmtEur(totalMes - prev)} vs ${before} (sem as despesas lançadas à mão)` : "massa salarial + frota + outras despesas"}
          icon={<Wallet size={15} />}
          delay={120}
        />
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="font-display text-[13px] font-semibold">Outras despesas da empresa</div>
            <div className="text-[11.5px] text-ink-3">Rendas, software, marketing e tudo o que não vem de pessoas nem de frota.</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input className="input w-48 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar…" aria-label="Procurar despesa" />
            </span>
            <button type="button" className="btn btn-primary" onClick={() => { setEdit(null); setOpen(true); }}>
              <Plus size={15} /> Nova despesa
            </button>
          </div>
        </div>

        {!rows.length ? (
          <Empty
            title={q ? "Nenhuma despesa neste filtro" : "Sem despesas lançadas"}
            text={q ? "Não há despesas com esse nome." : `Ainda não há despesas lançadas à mão em ${monthLabel(month)}. Usa "Nova despesa" para registar rendas, software ou outra despesa.`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Descrição</th>
                  <th className="label-mono px-4 py-3 font-normal">Categoria</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Valor</th>
                  <th className="label-mono px-4 py-3 font-normal">Notas</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5 font-medium">{r.description}</td>
                    <td className="px-4 py-2.5"><Pill tone="muted">{categoryLabel(r.category)}</Pill></td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{fmtEur2(r.amount)}</td>
                    <td className="px-4 py-2.5 text-ink-3">{r.notes || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Editar ${r.description}`}
                          className="rounded-md p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink"
                          onClick={() => { setEdit(r); setOpen(true); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${r.description}`}
                          className="rounded-md p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: r.id })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold" colSpan={2}>Total</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur2(rows.reduce((s, r) => s + r.amount, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Editar despesa" : "Nova despesa da empresa"}>
        {open && (
          <ExpenseForm
            key={edit ? `e${edit.id}` : "new"}
            month={month}
            initial={edit}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "200ms" }}>
        <div className="border-b border-line px-4 py-3">
          <div className="font-display text-[13px] font-semibold">Despesas por centro de custo</div>
          <div className="text-[11.5px] text-ink-3">Massa salarial, comissões, adiantamentos e frota repartidos por departamento.</div>
        </div>
        {!(exp?.centres ?? []).length ? (
          <Empty title="Sem custos neste mês" text={`Não há salários, pagamentos, adiantamentos ou custos de frota registados em ${monthLabel(month)}.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Centro de custo</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Pessoas</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Massa salarial</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Comissões</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Adiantamentos</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Frota</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Total do mês</th>
                </tr>
              </thead>
              <tbody>
                {(exp?.centres ?? []).map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      {c.isBucket && <div className="text-[11.5px] text-ink-3">pessoas e custos sem departamento associado</div>}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.count}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{fmtEur(c.payroll)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.commissions ? fmtEur(c.commissions) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.advances ? fmtEur(c.advances) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.fleet ? fmtEur(c.fleet) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{fmtEur(c.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold">Total</td>
                  <td className="num px-4 py-3 text-right font-semibold">{(exp?.centres ?? []).reduce((s, c) => s + c.count, 0)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(payroll)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur((exp?.centres ?? []).reduce((s, c) => s + c.commissions, 0))}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(exp?.advances ?? 0)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(fleet)}</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur((exp?.centres ?? []).reduce((s, c) => s + c.total, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <div className="mt-3 text-[11.5px] text-ink-3">
        As despesas lançadas à mão entram no total do mês mas não têm departamento: ficam fora da tabela por centro de custo.
      </div>
    </>
  );
}

function ExpenseForm({ month, initial, onClose }: { month: string; initial: { id: number; month: string; description: string; category: string; amount: number; notes: string | null } | null; onClose: () => void }) {
  const save = useSaveCompanyExpense();
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<Category>(() => (CATEGORIES.some((c) => c.key === initial?.category) ? (initial!.category as Category) : "outros"));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const valor = Number(String(amount).replace(",", "."));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const payload = { month: initial?.month ?? month, description: description.trim(), category, amount: Number.isFinite(valor) ? valor : 0, notes: notes.trim() || null };
        try {
          if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
          else await save.create.mutateAsync(payload);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Descrição" className="sm:col-span-2">
          <input aria-label="Descrição" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Renda do escritório" required />
        </Field>
        <Field label="Categoria">
          <select aria-label="Categoria" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valor (€)">
          <input aria-label="Valor" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <textarea aria-label="Notas" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} />
    </form>
  );
}

/* --------------------------------------------------------------- comissões */

function ComissoesTab({ month, com }: { month: string; com?: Finance["commissions"] }) {
  const rows = com?.rows ?? [];
  const records = com?.records ?? [];
  const estado = (s: string) =>
    s === "pago" ? <Pill tone="ok">pago</Pill> : s === "por_pagar" ? <Pill tone="warn">por pagar</Pill> : <Pill tone="muted">sem registo</Pill>;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registado a pagar" value={fmtEur(com?.registered ?? 0)} sub="autos de pagamento lançados no mês" icon={<FileCheck2 size={15} />} accent="var(--volt)" delay={0} />
        <Stat label="Já pago" value={fmtEur(com?.paid ?? 0)} sub={`${fmtEur(com?.pending ?? 0)} ainda por pagar`} icon={<Wallet size={15} />} accent="var(--sky)" delay={40} />
        <Stat label="Previsto no auto final" value={fmtEur(com?.expected ?? 0)} sub="o que o ficheiro da Iberdrola manda pagar" icon={<Calculator size={15} />} accent="var(--amber)" delay={80} />
        <Stat
          label="Diferença"
          value={fmtEur(Math.round(((com?.registered ?? 0) - (com?.expected ?? 0)) * 100) / 100)}
          sub="registado menos o que o auto final diz"
          icon={<TrendingUp size={15} />}
          accent={Math.abs((com?.registered ?? 0) - (com?.expected ?? 0)) < 0.005 ? "var(--volt)" : "var(--rose)"}
          delay={120}
        />
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        <div className="border-b border-line px-4 py-3">
          <div className="font-display text-[13px] font-semibold">Comissões por pessoa</div>
          <div className="text-[11.5px] text-ink-3">O que o auto final manda pagar, o que já está registado e o que já saiu em {monthLabel(month)}.</div>
        </div>
        {!rows.length ? (
          <Empty title="Sem comissões neste mês" text="Não há valores no auto final nem pagamentos registados." action={<Link to="/pagamentos" className="btn btn-ghost">Ir para Pagamentos</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Pessoa</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Previsto (auto)</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Registado</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Pago</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Diferença</th>
                  <th className="label-mono px-4 py-3 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dif = Math.round((r.registered - r.expected) * 100) / 100;
                  return (
                    <tr key={r.employeeId} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      <td className="px-4 py-2.5 font-medium">{r.employeeName}</td>
                      <td className="num px-4 py-2.5 text-right text-ink-2">{r.expected ? fmtEur(r.expected) : <span className="text-ink-3">—</span>}</td>
                      <td className="num px-4 py-2.5 text-right">{r.registered ? fmtEur(r.registered) : <span className="text-ink-3">—</span>}</td>
                      <td className="num px-4 py-2.5 text-right text-ink-2">{r.paid ? fmtEur(r.paid) : <span className="text-ink-3">—</span>}</td>
                      <td className="num px-4 py-2.5 text-right">
                        {Math.abs(dif) < 0.005 ? <span className="text-ink-3">—</span> : <span className={dif < 0 ? "text-rose" : "text-volt"}>{dif > 0 ? "+" : ""}{fmtEur(dif)}</span>}
                      </td>
                      <td className="px-4 py-2.5">{estado(r.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold">Total</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(com?.expected ?? 0)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(com?.registered ?? 0)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(com?.paid ?? 0)}</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur((com?.registered ?? 0) - (com?.expected ?? 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {records.length > 0 && (
        <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "200ms" }}>
          <div className="border-b border-line px-4 py-3">
            <div className="font-display text-[13px] font-semibold">Registos de pagamento</div>
            <div className="text-[11.5px] text-ink-3">Autos lançados em Pagamentos com mês de referência {monthLabel(month)}.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Pessoa</th>
                  <th className="label-mono px-4 py-3 font-normal">Tipo</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Valor</th>
                  <th className="label-mono px-4 py-3 font-normal">Estado</th>
                  <th className="label-mono px-4 py-3 font-normal">Data de pagamento</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5 font-medium">{r.employeeName}</td>
                    <td className="px-4 py-2.5 text-ink-2">{r.kind}</td>
                    <td className="num px-4 py-2.5 text-right">{fmtEur(r.amount)}</td>
                    <td className="px-4 py-2.5">{estado(r.status === "pago" ? "pago" : "por_pagar")}</td>
                    <td className="num px-4 py-2.5 text-ink-2">{r.paidOn ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- lucro */

function LucroTab({ month, lucro, exp, fin, forecast }: { month: string; lucro?: Finance["profit"]; exp?: Finance["expenses"]; fin?: Finance["final"]; forecast?: Finance["forecast"] }) {
  const revenue = lucro?.revenue ?? 0;
  const commissions = lucro?.commissions ?? 0;
  const expenses = lucro?.expenses ?? 0;
  const value = lucro?.value ?? 0;
  const positive = value >= 0;
  const revenueNote = lucro?.revenueSource === "final" ? "auto final do mês" : `previsão do CRM — ainda sem Excel da Iberdrola em ${monthLabel(month)}`;
  const commNote = lucro?.commissionsSource === "registado" ? "autos de pagamento registados" : lucro?.commissionsSource === "auto" ? "o que o auto final manda pagar" : "previsão de comissões do CRM";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Receita" value={fmtEur(revenue)} sub={lucro?.revenueSource === "final" ? "auto final do mês" : "previsão do CRM"} icon={<Wallet size={15} />} accent="var(--volt)" delay={0} />
        <Stat label="Comissões" value={fmtEur(commissions)} sub={commNote} icon={<HandCoins size={15} />} accent="var(--amber)" delay={40} />
        <Stat label="Despesas" value={fmtEur(expenses)} sub="salários, frota e outras despesas" icon={<Receipt size={15} />} accent="var(--rose)" delay={80} />
        <Stat
          label="Lucro da empresa"
          value={fmtEur(value)}
          sub={lucro?.margin != null ? `margem de ${(lucro.margin * 100).toFixed(1)}%` : "sem receita para calcular margem"}
          icon={positive ? <PiggyBank size={15} /> : <TrendingDown size={15} />}
          accent={positive ? "var(--volt)" : "var(--rose)"}
          delay={120}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card rise overflow-hidden" style={{ animationDelay: "160ms" }}>
          <div className="border-b border-line px-4 py-3">
            <div className="font-display text-[13px] font-semibold">Conta do mês</div>
            <div className="text-[11.5px] text-ink-3">O que a Iberdrola paga menos o que sai: comissões e despesas.</div>
          </div>
          <table className="w-full text-[12.5px]">
            <tbody>
              <ContaRow label="Auto final (receita)" value={fmtEur(revenue)} note={revenueNote} strong />
              <ContaRow label="Comissões a pagar aos comerciais" value={`− ${fmtEur(commissions)}`} note={commNote} />
              <ContaRow label="Massa salarial" value={`− ${fmtEur(exp?.payroll ?? 0)}`} note="salário base das pessoas no mês" />
              <ContaRow label="Frota" value={`− ${fmtEur(exp?.fleet ?? 0)}`} note="combustível, portagens e manutenções" />
              <ContaRow label="Outras despesas" value={`− ${fmtEur(exp?.manual ?? 0)}`} note={`${(exp?.rows ?? []).length} despesa(s) lançada(s) à mão`} />
              <ContaRow label="Lucro da empresa" value={fmtEur(value)} strong tone={positive ? "var(--volt)" : "var(--rose)"} />
            </tbody>
          </table>
        </div>

        <div className="card rise p-5" style={{ animationDelay: "200ms" }}>
          <div className="label-mono mb-3 flex items-center gap-2">
            <Calculator size={13} />
            Se o Excel vier igual à previsão
          </div>
          <div className="text-[13px] text-ink-2">
            {fin?.loaded ? "Auto final carregado" : "Sem auto final carregado"} — a previsão do CRM aponta para:
          </div>
          <div className="num mt-2 text-[24px] font-semibold" style={{ color: (lucro?.forecastProfit ?? 0) >= 0 ? "var(--volt)" : "var(--rose)" }}>
            {fmtEur(lucro?.forecastProfit ?? 0)}
          </div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            Previsão {fmtEur(forecast?.totals.gross ?? 0)} − comissões {fmtEur(lucro?.commissionsSource === "registado" ? commissions : (forecast?.totals.due ?? 0))} − despesas {fmtEur(expenses)}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[12px] text-ink-2">
            <div className="flex justify-between py-0.5">
              <span className="text-ink-3">Receita final</span>
              <span className="num">{fmtEur(fin?.totals.gross ?? 0)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-ink-3">Receita prevista</span>
              <span className="num">{fmtEur(forecast?.totals.gross ?? 0)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-ink-3">Comissões previstas</span>
              <span className="num">{fmtEur(forecast?.totals.due ?? 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
