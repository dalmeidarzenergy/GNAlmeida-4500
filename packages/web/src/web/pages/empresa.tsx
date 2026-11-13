/**
 * Página "Gestão de Empresa": o painel de administração da própria empresa —
 * dados da entidade, obrigações e indicadores de estrutura.
 *
 * Ainda é a base da secção: mostra o resumo do que existe na empresa a partir
 * das tabelas do CRM (departamentos, equipas, funcionários, clientes ativos e
 * comercializadores) e deixa o espaço pronto para as sub-páginas que se seguirem.
 */
import { Link } from "wouter";
import { Landmark, Users, UsersRound, Building2, Contact, Plug, ArrowUpRight } from "lucide-react";
import { PageHeader, Stat, Empty } from "../components/ui/kit";
import { useMe } from "../queries/me";
import { useDepartments, useTeams, useEmployees } from "../queries/hr";
import { useCustomSuppliers } from "../queries/suppliers";

export default function EmpresaPage() {
  const { data: me } = useMe();
  const deps = useDepartments();
  const teams = useTeams();
  const emps = useEmployees();
  const sups = useCustomSuppliers();

  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const loading = deps.isLoading || teams.isLoading || emps.isLoading;

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Gestão de Empresa"
        subtitle="Estrutura e dados da empresa num só sítio: departamentos, equipas, pessoas e comercializadores. As obrigações e os documentos da entidade vivem aqui."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Departamentos" value={n(deps.data)} sub="áreas da empresa" icon={<Building2 size={15} />} delay={0} />
        <Stat label="Equipas" value={n(teams.data)} sub="equipas comerciais" icon={<UsersRound size={15} />} accent="var(--sky)" delay={40} />
        <Stat label="Funcionários" value={n(emps.data)} sub="pessoas registadas" icon={<Users size={15} />} delay={80} />
        <Stat label="Comercializadores" value={n(sups.data)} sub="entidades parceiras" icon={<Plug size={15} />} accent="var(--amber)" delay={120} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card rise p-5 lg:col-span-2" style={{ animationDelay: "160ms" }}>
          <div className="label-mono mb-3 flex items-center gap-2">
            <Landmark size={13} />
            Acesso rápido
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { to: "/departamentos", label: "Departamentos e cargos", text: "Estrutura e funções" },
              { to: "/equipas", label: "Equipas", text: "Chefes e elementos" },
              { to: "/funcionarios", label: "Funcionários", text: "Ficha de cada pessoa" },
              { to: "/comercializadores", label: "Comercializadores", text: "Parceiros e fornecedores" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="group flex items-center justify-between rounded-[10px] border border-line bg-bg/50 px-3.5 py-3 transition hover:border-volt/40 hover:bg-volt/5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{l.label}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{l.text}</span>
                </span>
                <ArrowUpRight size={14} className="shrink-0 text-ink-3 transition group-hover:text-volt" />
              </Link>
            ))}
          </div>
        </div>

        <div className="card rise p-5" style={{ animationDelay: "200ms" }}>
          <div className="label-mono mb-3 flex items-center gap-2">
            <Contact size={13} />
            A minha conta
          </div>
          <div className="text-[13px] font-medium">{me?.name ?? "—"}</div>
          <div className="mt-0.5 text-[11.5px] text-ink-3">{me?.email ?? ""}</div>
          <div className="mt-3 text-[12px] text-ink-2">
            <span className="text-ink-3">Perfil: </span>
            {me?.role ?? "—"}
          </div>
        </div>
      </div>

      <div className="card rise mt-6" style={{ animationDelay: "240ms" }}>
        {loading ? (
          <div className="px-6 py-16 text-center text-[13px] text-ink-3">A carregar…</div>
        ) : (
          <Empty
            title="Secção em preparação"
            text="Aqui vão ficar os dados da entidade, obrigações e documentos da empresa. Diz o que queres acrescentar a seguir."
          />
        )}
      </div>
    </>
  );
}
