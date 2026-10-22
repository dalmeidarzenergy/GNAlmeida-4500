import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, UsersRound, Building2, CalendarDays, UserSearch, Contact, ShoppingCart, Target, Megaphone, BarChart3, TrendingUp, ShieldCheck, LogOut, Menu, X, Zap, Calendar, MapPin,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth";
import { useMe } from "../queries/me";
import { ROLE_LABEL } from "../lib/labels";
import { Avatar } from "./ui/kit";

import type { Role } from "../../api/middleware/auth";
export type { Role };
type NavItem = { to: string; label: string; icon: typeof Users; roles: Role[] };

const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Geral", items: [{ to: "/", label: "Painel", icon: LayoutDashboard, roles: ["admin", "rh", "chefe", "vendedor"] }] },
  {
    group: "Recursos Humanos",
    items: [
      { to: "/funcionarios", label: "Funcionários", icon: Users, roles: ["admin", "rh"] },
      { to: "/departamentos", label: "Departamentos e cargos", icon: Building2, roles: ["admin", "rh"] },
      { to: "/equipas", label: "Equipas", icon: UsersRound, roles: ["admin", "rh", "chefe"] },
      { to: "/ausencias", label: "Férias e ausências", icon: CalendarDays, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/recrutamento", label: "Recrutamento", icon: UserSearch, roles: ["admin", "rh"] },
    ],
  },
  {
    group: "Vendas",
    items: [
      { to: "/clientes", label: "Clientes", icon: Contact, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/vendas", label: "Vendas", icon: ShoppingCart, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/campanhas", label: "Campanhas", icon: Megaphone, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/agenda", label: "Agenda", icon: Calendar, roles: ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"] },
      { to: "/metas", label: "Metas", icon: Target, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/terreno-d2d", label: "Terreno D2D", icon: MapPin, roles: ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"] },
    ],
  },
  {
    group: "Análise",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["admin", "rh", "chefe"] },
      { to: "/evolucao", label: "Evolução", icon: TrendingUp, roles: ["admin", "rh", "chefe", "vendedor"] },
      { to: "/utilizadores", label: "Utilizadores", icon: ShieldCheck, roles: ["admin", "diretor", "backoffice"] },
    ],
  },
];

export function canAccess(path: string, role: Role) {
  for (const g of NAV) for (const i of g.items) if (i.to === path) return i.roles.includes(role);
  return true;
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-volt text-[#0c0e0d] shadow-[0_0_24px_rgba(198,244,50,0.35)]">
        <Zap size={17} strokeWidth={2.6} fill="currentColor" />
      </div>
      <div className="font-display text-[17px] font-bold tracking-tight">
        GN<span className="text-volt">Almeida</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [loc, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const role = (me.data?.role ?? "vendedor") as Role;

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/entrar");
  };

  const sidebar = (
    <aside className="flex h-full w-[248px] flex-col border-r border-line bg-[#0f1210]">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="btn-icon lg:hidden" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.roles.includes(role));
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
          <Avatar name={me.data?.name || me.data?.email || "?"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{me.data?.name || me.data?.email}</div>
            <div className="text-[11px] text-ink-3">{ROLE_LABEL[role]}</div>
          </div>
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
          <button type="button" aria-label="Fechar menu" className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="min-w-0 flex-1 lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
          <button className="btn-icon" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <Logo />
        </header>
        <main className="mx-auto max-w-[1400px] px-5 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
