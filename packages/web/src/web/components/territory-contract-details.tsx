import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { SALE_COUNTED } from "../../api/shared/client-forms";
import type { Territory } from "../../api/shared/territories";
import { useTerritoryContracts } from "../queries/territories";
import { Empty, Modal } from "./ui/kit";

type Sale = NonNullable<ReturnType<typeof useTerritoryContracts>["data"]>["sales"][number];
type EmployeeGroup = { name: string; total: number; counted: number; months: Map<string, Sale[]> };
const monthFormat = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const number = new Intl.NumberFormat("pt-PT");
const isCounted = (sale: Sale) => SALE_COUNTED.includes(sale.status);
const contractLabel = (n: number) => `${number.format(n)} ${n === 1 ? "contrato" : "contratos"}`;

function groupByEmployee(sales: Sale[] = []) {
  const groups = new Map<number | null, EmployeeGroup>();
  for (const sale of sales) {
    const employee = groups.get(sale.employeeId) ?? { name: sale.employeeName ?? "Sem funcionário atribuído", total: 0, counted: 0, months: new Map<string, Sale[]>() };
    const month = /^\d{4}-(?:0[1-9]|1[0-2])(?=-|$)/.exec(sale.date)?.[0] ?? "";
    const items = employee.months.get(month) ?? [];
    items.push(sale);
    employee.months.set(month, items);
    employee.total++;
    if (isCounted(sale)) employee.counted++;
    groups.set(sale.employeeId, employee);
  }
  return [...groups].sort(([aId, a], [bId, b]) => aId === null ? 1 : bId === null ? -1 : b.total - a.total || a.name.localeCompare(b.name, "pt-PT"));
}

function dateLabel(date: string) {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(+parsed) ? "—" : dayFormat.format(parsed);
}

function SalesMonth({ month, sales }: { month: string; sales: Sale[] }) {
  const label = month ? monthFormat.format(new Date(`${month}-01T00:00:00Z`)) : "Sem mês identificado";
  return <section className="overflow-hidden rounded-lg border border-line" aria-label={label}>
    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2 text-xs">
      <h3 className="font-semibold capitalize">{label}</h3>
      <span className="text-ink-2">{contractLabel(sales.length)}</span>
    </div>
    <div className="overflow-x-auto" role="region" aria-label={`Contratos — ${label}`} tabIndex={0}>
      <table className="w-full min-w-[480px] text-left text-xs">
        <thead className="text-ink-2"><tr>
          {["N.º do contrato", "Ref. da venda", "Data da venda", "Estado atual"].map((label) => <th scope="col" className="px-3 py-2 font-medium" key={label}>{label}</th>)}
        </tr></thead>
        <tbody>{sales.map((sale) => <tr className="border-t border-line" key={sale.id}>
          <td className="num max-w-48 break-words px-3 py-2">{sale.contractNumber?.trim() || "—"}</td>
          <td className="num whitespace-nowrap px-3 py-2">{sale.reference}</td>
          <td className="whitespace-nowrap px-3 py-2">{dateLabel(sale.date)}</td>
          <td className="px-3 py-2"><span className={`inline-block rounded-full border border-line px-2 py-0.5 ${isCounted(sale) ? "bg-volt/10 text-volt" : "bg-surface-2 text-ink"}`}>{sale.status}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function TerritoryContractDetails({ territory, onClose }: { territory: Territory; onClose: () => void }) {
  const query = useTerritoryContracts(territory.id);
  const groups = useMemo(() => groupByEmployee(query.data?.sales), [query.data?.sales]);
  const counted = groups.reduce((total, [, group]) => total + group.counted, 0);
  return <Modal open size="wide" title={`Contratos em ${territory.municipality}`} onClose={onClose}>
    <p className="mb-4 text-sm text-ink-2">{territory.district} · Todos os estados. O mês corresponde à data da venda, não à data de entrada em fornecimento.</p>
    {query.isPending ? <div className="skeleton h-24" aria-label="A carregar contratos" /> : query.isError ? (
      <Empty title="Não foi possível carregar os contratos" action={<button type="button" className="btn btn-ghost" onClick={() => void query.refetch()}>Tentar novamente</button>} />
    ) : !query.data.recognized ? (
      <Empty title="Concelho não reconhecido" text="Confirma o distrito e o nome oficial do concelho." />
    ) : !groups.length ? (
      <Empty title="Não há contratos neste concelho" />
    ) : <>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
        <span><strong className="num">{number.format(query.data.sales.length)}</strong> no total</span>
        <span><strong className="num">{number.format(counted)}</strong> em fornecimento</span>
      </div>
      <div className="space-y-2">
        {groups.map(([id, group], index) => <details key={id ?? "unassigned"} open={index === 0} className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2 font-semibold"><ChevronDown size={15} className="shrink-0 -rotate-90 group-open:rotate-0" aria-hidden="true" /> {group.name}</span>
            <span className="text-xs text-ink-2">{contractLabel(group.total)} · {number.format(group.counted)} em fornecimento</span>
          </summary>
          <div className="space-y-2 px-3 pb-3">
            {[...group.months].sort(([a], [b]) => b.localeCompare(a)).map(([month, sales]) => <SalesMonth key={month} month={month} sales={sales} />)}
          </div>
        </details>)}
      </div>
    </>}
  </Modal>;
}