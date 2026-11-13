import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ClipboardList, LayoutDashboard, Users, UsersRound, Building2, CalendarDays, UserSearch, Contact, ShoppingCart, Target, Megaphone, BarChart3, TrendingUp, ShieldCheck, LogOut, Menu, X, Calendar, MapPin, Route, Calculator, Sun, Moon, Scale, Gauge, Table, Wallet, FileSpreadsheet, Sparkles, CreditCard, Timer, ShieldAlert, Mail, Plug, Pin, PinOff, FileText, HandCoins, SlidersHorizontal, ChevronRight, Briefcase, Map, Headset, Banknote, PieChart, Settings, Ruler, FileCheck, Landmark,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth";
import { useMe } from "../queries/me";
import { ROLE_LABEL } from "../lib/labels";
import { Avatar, Credit } from "./ui/kit";
import { NotificationsBell } from "./notifications-bell";

import type { Permissions, ModuleKey, Role } from "../../api/middleware/auth";
export type { Role, Permissions };
type NavItem = { to: string; key: ModuleKey; label: string; icon: typeof Users };
type NavGroup = { group: string; icon: typeof Users; items: NavItem[] };

/** Titulo de cada grupo do menu, com o icone que o representa e que aparece
 * sozinho no rail recolhido. "Geral" nao tem titulo clicavel: e um item solto. */
const NAV: NavGroup[] = [
  { group: "Geral", icon: LayoutDashboard, items: [{ to: "/", key: "painel", label: "Painel", icon: LayoutDashboard }] },
  {
    group: "Recursos Humanos",
    icon: Briefcase,
    items: [
      { to: "/funcionarios", key: "funcionarios", label: "Funcionários", icon: Users },
      { to: "/departamentos", key: "departamentos", label: "Departamentos e cargos", icon: Building2 },
      { to: "/equipas", key: "equipas", label: "Equipas", icon: UsersRound },
      { to: "/ausencias", key: "ausencias", label: "Férias e ausências", icon: CalendarDays },
      { to: "/recrutamento", key: "recrutamento", label: "Recrutamento", icon: UserSearch },
      { to: "/tabelas-comissionais", key: "tabelas-comissionais", label: "Tabelas Comissionais", icon: Table },
    ],
  },
  {
    group: "Vendas",
    icon: ShoppingCart,
    items: [
      { to: "/clientes", key: "clientes", label: "Clientes", icon: Contact },
      { to: "/vendas", key: "vendas", label: "Vendas", icon: ShoppingCart },
      { to: "/vendas-criticas", key: "vendas-criticas", label: "Vendas Críticas", icon: Timer },
      { to: "/estado-vtv", key: "estado-vtv", label: "Estado VTV", icon: ShieldAlert },
      { to: "/w2l", key: "w2l", label: "W2L", icon: ClipboardList },
      { to: "/metas", key: "metas", label: "Metas", icon: Target },
    ],
  },
  {
    group: "Gestão Territorial",
    icon: Map,
    items: [
      { to: "/terreno-d2d", key: "terreno-d2d", label: "Terreno D2D", icon: MapPin },
      { to: "/historico-gps", key: "terreno-d2d", label: "Histórico GPS", icon: Route },
    ],
  },
  {
    group: "Apoio Comercial",
    icon: Headset,
    items: [
      { to: "/agenda", key: "agenda", label: "Agenda", icon: Calendar },
      { to: "/campanhas", key: "campanhas", label: "Campanhas", icon: Megaphone },
      { to: "/simulador-res-neg", key: "simulador-iberdrola", label: "Simulador RES/NEG", icon: Calculator },
      { to: "/simulador-medem", key: "simulador-medem", label: "Simulador Medem", icon: Ruler },
      { to: "/completar-iban", key: "completar-iban", label: "Completar IBAN", icon: CreditCard },
    ],
  },
  {
    group: "Propostas",
    icon: FileCheck,
    items: [
      { to: "/propostas", key: "propostas", label: "Propostas", icon: FileCheck },
    ],
  },
  {
    group: "Pagamentos",
    icon: Banknote,
    items: [
      { to: "/pagamentos", key: "pagamentos", label: "Previsão de Pagamentos", icon: Wallet },
      { to: "/auto-iberdrola", key: "auto-iberdrola", label: "Auto Iberdrola", icon: FileSpreadsheet },
      { to: "/autos", key: "auto-iberdrola", label: "Autos", icon: FileText },
      { to: "/adiantamentos", key: "adiantamentos", label: "Adiantamentos", icon: HandCoins },
      { to: "/regras", key: "regras", label: "Regras", icon: Scale },
      { to: "/incentivos", key: "incentivos", label: "Incentivos", icon: Sparkles },
    ],
  },
  {
    group: "GESTÃO DE EMPRESA",
    icon: Landmark,
    items: [
      { to: "/empresa", key: "empresa", label: "Gestão de Empresa", icon: Landmark },
    ],
  },
  {
    group: "Análise",
    icon: PieChart,
    items: [
      { to: "/relatorios", key: "relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/evolucao", key: "evolucao", label: "Evolução", icon: TrendingUp },
      { to: "/comparativo", key: "comparativo", label: "Comparativo", icon: Scale },
      { to: "/medem", key: "medem", label: "Análise MEDEM", icon: Gauge },
      { to: "/filtragem", key: "filtragem", label: "Filtragem", icon: SlidersHorizontal },
    ],
  },
  {
    group: "Definições",
    icon: Settings,
    items: [
      { to: "/comercializadores", key: "comercializadores", label: "Comercializadores", icon: Plug },
      { to: "/catalogo-simulador", key: "catalogo-simulador", label: "Catálogo do simulador", icon: SlidersHorizontal },
      { to: "/utilizadores", key: "utilizadores", label: "Utilizadores", icon: ShieldCheck },
    ],
  },
];

export function canAccess(path: string, permissions: Permissions) {
  for (const g of NAV) for (const i of g.items) if (i.to === path) return permissions[i.key]?.view ?? false;
  return true;
}

/** O logotipo tem duas versoes: a de tema claro (letras azul-escuras) e a de
 * tema escuro (letras em ciano), porque o azul-escuro da marca sobre o fundo
 * quase-preto da app nao passa no contraste minimo de leitura. */
export function useBrandLogo() {
  const [logo, setLogo] = useState("/icons/logo.png");
  useEffect(() => {
    const pick = () => setLogo(document.documentElement.getAttribute("data-theme") === "light" ? "/icons/logo.png" : "/icons/logo-dark.png");
    pick();
    const mo = new MutationObserver(pick);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return logo;
}

export function Logo() {
  const src = useBrandLogo();
  return (
    <div className="flex items-center gap-2.5">
      <img src={src} alt="D2D Consulting" className="h-9 w-auto shrink-0 object-contain" />
    </div>
  );
}

function useTheme() {
  const [theme, set] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("theme") as "dark" | "light") || "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () => set((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggle] as const;
}
function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });
  const [pinned, setPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-pinned") === "true";
  });
  const [hovering, setHovering] = useState(false);

  useEffect(() => { localStorage.setItem("sidebar-collapsed", String(collapsed)); }, [collapsed]);
  useEffect(() => { localStorage.setItem("sidebar-pinned", String(pinned)); }, [pinned]);

  const expanded = pinned || hovering;
  const togglePin = () => {
    if (pinned) { setPinned(false); setCollapsed(true); }
    else { setPinned(true); setCollapsed(false); }
  };

  return { collapsed, pinned, expanded, hovering, setHovering, togglePin } as const;
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [loc, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [hovering, setHovering] = useState(false);
  const qc = useQueryClient();
  const role = (me.data?.role ?? "vendedor") as Role;
  const permissions = me.data?.permissions;
  const [theme, toggleTheme] = useTheme();
  const logoDark = useBrandLogo();

  const expanded = pinned || hovering;
  const togglePin = () => setPinned(!pinned);

  /** O menu e um acordeao: so um grupo fica aberto de cada vez. O grupo que
   * contem a pagina atual abre sozinho, para nao perderes o contexto ao
   * navegar. `openGroup` guarda o nome do grupo aberto (null = todos fechados). */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  /** O grupo ativo e o que contem a pagina onde estamos. */
  const activeGroup = NAV.find((g) =>
    g.items.some((i) => (i.to === "/" ? loc === "/" : loc.startsWith(i.to))),
  )?.group ?? null;

  /** Ao mudar de pagina ou de permissoes, abre o grupo da pagina atual.
   * Depende de `activeGroup` para o menu seguir a navegacao (links diretos,
   * voltar atras do browser) sem o utilizador ter de clicar no titulo. */
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  /** No telemovel o menu e uma gaveta: abre no botao do cabecalho. Em ecra
   * estreito o rail lateral colapsa sozinho (ver `data-shell` no styles.css) e
   * os nomes das abas aparecem na gaveta; em ecra grande fica aberto. */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => document.documentElement.setAttribute("data-shell", mq.matches ? "mobile" : "desktop");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/entrar");
  };

  /**
   * O menu lateral e o mesmo em desktop e no telemovel, mas no telemovel o
   * `hover` nunca acontece (o toque nao dispara mouseenter) e o botao de fixar
   * esta escondido — por isso a gaveta ficaria sempre so com icones. Na gaveta
   * (`drawer`) o menu aparece sempre aberto, com o nome das abas.
   *
   * Em ecra grande o menu fica sempre aberto por omissao (chega para veres os
   * nomes das abas, incluindo as de baixo); o botao de fixar permite voltar a
   * fecha-lo se quiseres mais espaco.
   */

  const renderSidebar = (drawer = false) => {
    const wide = drawer || expanded;
    return (
    <aside
      className={`flex h-full flex-col border-r border-line transition-[width] duration-200 ${wide ? "w-[248px]" : "w-[64px]"}`}
      style={{ background: "var(--sidebar-bg)" }}
      onMouseEnter={() => !drawer && setHovering(true)}
      onMouseLeave={() => !drawer && setHovering(false)}
    >
      <div className={`flex h-16 items-center ${wide ? "justify-between px-5" : "justify-center"}`}>
        {wide ? <Logo /> : <img src={logoDark} alt="D2D" className="h-7 w-auto shrink-0 object-contain" />}
        <button className={`btn-icon lg:hidden ${wide ? "" : "absolute right-2 top-2"}`} onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
      <div className={drawer ? "hidden" : `flex ${wide ? "justify-end" : "justify-center"} px-3 pb-1`}>
        <button className="btn-icon hidden lg:flex" onClick={togglePin} title={pinned ? "Desafixar menu" : "Fixar menu"}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => permissions?.[i.key]?.view !== false);
          if (!items.length) return null;

          /** "Geral" e um item solto (so o Painel), sem titulo clicavel. */
          if (g.items.length === 1 && g.group === "Geral") {
            const i = items[0];
            const Icon = i.icon;
            const active = i.to === "/" ? loc === "/" : loc.startsWith(i.to);
            return (
              <div key={g.group} className="mt-2">
                <Link
                  to={i.to}
                  onClick={() => setOpen(false)}
                  title={wide ? undefined : i.label}
                  className={`group relative mb-0.5 flex h-9 items-center gap-3 rounded-[9px] transition ${wide ? "px-3 text-[13px]" : "justify-center px-0"} ${active ? "bg-volt/10 font-medium text-volt" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
                >
                  {active && wide && <span className="absolute -left-3 top-1.5 h-6 w-[3px] rounded-r bg-volt" />}
                  <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                  {wide && i.label}
                </Link>
              </div>
            );
          }

          const GIcon = g.icon;
          const isOpen = openGroup === g.group;
          const hasActive = items.some((i) => (i.to === "/" ? loc === "/" : loc.startsWith(i.to)));
          return (
            <div key={g.group} className="mt-1.5 first:mt-2">
              {/* Titulo do grupo: botao que abre/fecha a lista de paginas.
                  No rail recolhido mostra so o icone; ao clicar, o rail
                  expande-se (setHovering) e o grupo abre. */}
              <button
                type="button"
                title={g.group}
                aria-expanded={wide ? isOpen : undefined}
                onClick={() => {
                  if (!wide) { setHovering(true); if (openGroup !== g.group) setOpenGroup(g.group); return; }
                  setOpenGroup(isOpen ? null : g.group);
                }}
                className={`group flex h-9 w-full items-center gap-3 rounded-[9px] transition ${wide ? "px-3" : "justify-center px-0"} ${isOpen && wide ? "text-ink" : hasActive ? "text-volt" : "text-ink-2"} hover:bg-surface hover:text-ink`}
              >
                <GIcon size={wide ? 16 : 17} strokeWidth={hasActive ? 2.2 : 1.9} className="shrink-0" />
                {wide && (
                  <>
                    <span className="label-mono flex-1 text-left text-[10.5px] !text-current">{g.group}</span>
                    <ChevronRight size={14} className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                  </>
                )}
              </button>
              {/* `grid-rows` anima a altura sem medir o conteudo. */}
              {wide && (
                <div className={`grid transition-all duration-200 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    {items.map((i) => {
                      const active = i.to === "/" ? loc === "/" : loc.startsWith(i.to);
                      const Icon = i.icon;
                      return (
                        <Link
                          key={i.to}
                          to={i.to}
                          onClick={() => setOpen(false)}
                          className={`group relative mb-0.5 flex min-h-9 items-center gap-3 rounded-[9px] py-1.5 pl-9 pr-3 text-[13px] leading-snug transition ${active ? "bg-volt/10 font-medium text-volt" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
                        >
                          {active && <span className="absolute left-3 top-1.5 h-6 w-[3px] rounded-r bg-volt" />}
                          <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                          {i.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        {wide ? (
          <div className="flex items-center gap-3 rounded-[10px] p-2">
            <Avatar name={me.data?.name || me.data?.email || "?"} src={me.data?.image} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{me.data?.name || me.data?.email}</div>
              <div className="text-[11px] text-ink-3">{ROLE_LABEL[role]}</div>
            </div>
            <button className="btn-icon" onClick={toggleTheme} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="btn-icon" onClick={signOut} title="Terminar sessão">
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Avatar name={me.data?.name || me.data?.email || "?"} src={me.data?.image} />
            <button className="btn-icon" onClick={toggleTheme} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="btn-icon" onClick={signOut} title="Terminar sessão">
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </aside>
    );
  };

  return (
    <div className="flex min-h-screen">
      <div className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w,248px)] transition-[width] duration-200 lg:block">{renderSidebar()}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="animate-in slide-in-from-left duration-200">{renderSidebar(true)}</div>
          <button type="button" aria-label="Fechar menu" className="flex-1" style={{ background: "var(--overlay-bg)" }} onClick={() => setOpen(false)} />
        </div>
      )}
      <div className={`relative min-w-0 flex-1 pb-12 transition-[padding] duration-200 ${expanded ? "lg:pl-[248px]" : "lg:pl-[64px]"}`}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur">
          <button className="btn-icon lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="lg:hidden"><Logo /></div>
          <div className="flex-1" />
          {permissions?.["terreno-d2d"]?.view !== false && (
            <Link to="/terreno-d2d?view=caixa" className="btn-icon" title="Caixa de mensagens (Terreno D2D)">
              <Mail size={16} />
            </Link>
          )}
          <NotificationsBell />
        </header>
        {/* pb-12 reserva espaco para a assinatura fixa nao tapar o ultimo elemento. */}
        <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 py-8 pb-14 lg:px-8">{children}</main>
      </div>
      <Credit />
    </div>
  );
}