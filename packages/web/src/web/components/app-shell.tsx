import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ClipboardList, LayoutDashboard, Users, UsersRound, Building2, CalendarDays, UserSearch, Contact, ShoppingCart, Target, Megaphone, BarChart3, TrendingUp, ShieldCheck, LogOut, Menu, X, Calendar, MapPin, Calculator, Sun, Moon, Scale, Gauge, Table, Wallet, FileSpreadsheet, Sparkles, CreditCard, Timer, ShieldAlert, Mail,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth";
import { useMe } from "../queries/me";
import { ROLE_LABEL } from "../lib/labels";
import { Avatar } from "./ui/kit";
import { NotificationsBell } from "./notifications-bell";

import type { Permissions, ModuleKey, Role } from "../../api/middleware/auth";
export type { Role, Permissions };
type NavItem = { to: string; key: ModuleKey; label: string; icon: typeof Users };

const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Geral", items: [{ to: "/", key: "painel", label: "Painel", icon: LayoutDashboard }] },
  {
    group: "Recursos Humanos",
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
    items: [
      { to: "/clientes", key: "clientes", label: "Clientes", icon: Contact },
      { to: "/vendas", key: "vendas", label: "Vendas", icon: ShoppingCart },
      { to: "/vendas-criticas", key: "vendas-criticas", label: "Vendas Críticas", icon: Timer },
      { to: "/estado-vtv", key: "estado-vtv", label: "Estado VTV", icon: ShieldAlert },
      { to: "/w2l", key: "w2l", label: "W2L", icon: ClipboardList },
      { to: "/campanhas", key: "campanhas", label: "Campanhas", icon: Megaphone },
      { to: "/agenda", key: "agenda", label: "Agenda", icon: Calendar },
      { to: "/metas", key: "metas", label: "Metas", icon: Target },
      { to: "/terreno-d2d", key: "terreno-d2d", label: "Terreno D2D", icon: MapPin },
      { to: "/simulador-iberdrola", key: "simulador-iberdrola", label: "Simulador Iberdrola", icon: Calculator },
      { to: "/completar-iban", key: "completar-iban", label: "Completar IBAN", icon: CreditCard },
    ],
  },
  {
    group: "Pagamentos",
    items: [
      { to: "/pagamentos", key: "pagamentos", label: "Previsão de Pagamentos", icon: Wallet },
      { to: "/auto-iberdrola", key: "auto-iberdrola", label: "Auto Iberdrola", icon: FileSpreadsheet },
      { to: "/regras", key: "regras", label: "Regras", icon: Scale },
      { to: "/incentivos", key: "incentivos", label: "Incentivos", icon: Sparkles },
    ],
  },
  {
    group: "Análise",
    items: [
      { to: "/relatorios", key: "relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/evolucao", key: "evolucao", label: "Evolução", icon: TrendingUp },
      { to: "/comparativo", key: "comparativo", label: "Comparativo", icon: Scale },
      { to: "/medem", key: "medem", label: "Análise MEDEM", icon: Gauge },
      { to: "/utilizadores", key: "utilizadores", label: "Utilizadores", icon: ShieldCheck },
    ],
  },
];

export function canAccess(path: string, permissions: Permissions) {
  for (const g of NAV) for (const i of g.items) if (i.to === path) return permissions[i.key]?.view ?? false;
  return true;
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icons/logo.png" alt="D2D Consulting" className="h-9 w-auto shrink-0 object-contain" />
      <div className="min-w-0 truncate font-display text-[17px] font-bold tracking-tight">
        D2D <span className="text-volt">Consulting</span>
      </div>
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

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [loc, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const role = (me.data?.role ?? "vendedor") as Role;
  const permissions = me.data?.permissions;
  const [theme, toggleTheme] = useTheme();

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/entrar");
  };

  const sidebar = (
    <aside className="flex h-full w-[248px] flex-col border-r border-line" style={{ background: "var(--sidebar-bg)" }}>
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="btn-icon lg:hidden" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => permissions?.[i.key]?.view !== false);
          if (!items.length) return null;
          return (
            <div key={g.group} className="mt-5 first:mt-2">
              <div className="label-mono mb-2 px-3">{g.group}</div>
              {items.map((i) => {
                const active = i.to === "/" ? loc === "/" : loc.startsWith(i.to);
                const Icon = i.icon;
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className={`group relative mb-0.5 flex h-9 items-center gap-3 rounded-[9px] px-3 text-[13px] transition ${active ? "bg-volt/10 font-medium text-volt" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
                  >
                    {active && <span className="absolute -left-3 top-1.5 h-6 w-[3px] rounded-r bg-volt" />}
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
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
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="animate-in slide-in-from-left duration-200">{sidebar}</div>
          <button type="button" aria-label="Fechar menu" className="flex-1" style={{ background: "var(--overlay-bg)" }} onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="min-w-0 flex-1 lg:pl-[248px]">
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
        <main className="mx-auto max-w-[1400px] px-5 py-8 lg:px-8">{children}</main>
        <footer className="px-5 pb-5 text-right text-[11px] text-ink-3 lg:px-8">
          *Desenvolvido por Diogo Almeida
        </footer>
      </div>
    </div>
  );
}