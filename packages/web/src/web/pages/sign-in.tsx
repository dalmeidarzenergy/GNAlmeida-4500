import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { Loader2, Sun, BatteryCharging, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth";
import { Logo } from "../components/app-shell";
import { Field } from "../components/ui/kit";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function SignInPage() {
  const { data: session, isPending } = authClient.useSession();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);

  if (!isPending && session) return <Redirect to="/" />;

  const done = () => {
    qc.clear();
    navigate("/");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("email");
    const res = await authClient.signIn.email({ email, password });
    setBusy(null);
    if (res.error) {
      const msg = res.error.message ?? "";
      setError(
        /invalid email or password/i.test(msg)
          ? "Email ou palavra-passe incorretos."
          : /already exists/i.test(msg)
            ? "Já existe uma conta com este email."
            : /password.*short/i.test(msg)
              ? "A palavra-passe deve ter pelo menos 8 caracteres."
              : msg || "Não foi possível continuar.",
      );
      return;
    }
    done();
  };

  const google = async () => {
    setError(null);
    setBusy("google");
    const result = await authClient.managedAuth.signIn({ provider: "google" });
    setBusy(null);
    if (result.error && result.error.code !== "POPUP_CLOSED") setError(result.error.message ?? "Falha no login com Google");
    else if (!result.error) done();
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="noise grid-bg relative hidden overflow-hidden border-r border-line bg-[#0f1210] p-12 lg:flex lg:flex-col">
        <div className="absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-volt/10 blur-[120px]" />
        <div className="absolute -bottom-40 right-0 h-[380px] w-[380px] rounded-full bg-amber/10 blur-[120px]" />
        <Logo />
        <div className="relative mt-auto max-w-xl">
          <div className="label-mono mb-5 text-volt">Plataforma interna</div>
          <h1 className="text-[52px] font-bold leading-[1.02]">
            Pessoas e vendas,
            <br />
            <span className="text-volt">num só circuito.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-2">
            Gerir equipas, férias, recrutamento, clientes, encomendas e metas comerciais da GNAlmeida num único painel.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              { i: Users, t: "Equipas", s: "RH completo" },
              { i: Sun, t: "Vendas", s: "Encomendas e clientes" },
              { i: BatteryCharging, t: "Metas", s: "Comissões em tempo real" },
            ].map(({ i: I, t, s }, k) => (
              <div key={t} className="card rise bg-surface/70 p-4 backdrop-blur" style={{ animationDelay: `${200 + k * 80}ms` }}>
                <I size={18} className="text-volt" />
                <div className="mt-3 font-display text-[14px] font-semibold">{t}</div>
                <div className="text-[12px] text-ink-3">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="rise w-full max-w-[380px]">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-[26px] font-semibold">Bem-vindo de volta</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-2">Entre para aceder ao painel. O acesso é criado pelo seu responsável.</p>

          <button className="btn btn-ghost mt-8 h-11 w-full" onClick={google} disabled={busy !== null}>
            {busy === "google" ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
            Continuar com Google
          </button>

          <div className="my-6 flex items-center gap-3 text-[11px] text-ink-3">
            <div className="h-px flex-1 bg-line" /> ou com email <div className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <input aria-label="Email" className="input h-11" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@gnalmeida.pt" required />
            </Field>
            <Field label="Palavra-passe">
              <input aria-label="Palavra-passe" className="input h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={8} required />
            </Field>
            {error && <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <button className="btn btn-primary h-11 w-full" disabled={busy !== null}>
              {busy === "email" ? <Loader2 size={16} className="animate-spin" /> : "Entrar"}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
