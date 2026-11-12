import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Save, SlidersHorizontal } from "lucide-react";
import { orpc } from "../lib/api";
import { Modal } from "../components/ui/kit";
import { errMsg } from "../lib/format";

/** Linha de proposta tal como a lista a devolve. */
export type PropostaEditavel = {
  id: string;
  clientName: string | null;
  clientNif: string | null;
  segment: string | null;
  bestPlan: string | null;
  saving: number | null;
  source: string;
};

/** O simulador que sabe reabrir cada origem. */
const SIMULADOR: Record<string, { href: string; nome: string }> = {
  "res-neg": { href: "/simulador-res-neg", nome: "Simulador de campanhas" },
  medem: { href: "/simulador-medem", nome: "Simulador Medem" },
};

const campo = "h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-[13px] text-ink";

/**
 * Edita uma proposta: os dados de topo aqui, os calculos ao reabrir no simulador.
 * Reabrir leva o id da proposta, para que gravar substitua em vez de duplicar.
 */
export function EditProposta({
  proposta,
  onClose,
}: {
  proposta: PropostaEditavel | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [cliente, setCliente] = useState("");
  const [nif, setNif] = useState("");
  const [segmento, setSegmento] = useState("");
  const [plano, setPlano] = useState("");
  const [poupanca, setPoupanca] = useState("");

  // Recomeça os campos sempre que abre noutra proposta.
  useEffect(() => {
    if (!proposta) return;
    setCliente(proposta.clientName ?? "");
    setNif(proposta.clientNif ?? "");
    setSegmento(proposta.segment ?? "");
    setPlano(proposta.bestPlan ?? "");
    setPoupanca(proposta.saving == null ? "" : String(Math.round(proposta.saving * 100) / 100));
  }, [proposta]);

  const guardar = useMutation({
    ...orpc.propostas.update.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orpc.propostas.key() });
      onClose();
    },
  });

  const sim = proposta ? SIMULADOR[proposta.source] ?? SIMULADOR["res-neg"] : null;
  const num = poupanca.trim() === "" ? null : Number(poupanca.replace(",", "."));
  const valido = num === null || Number.isFinite(num);

  return (
    <Modal open={!!proposta} onClose={() => !guardar.isPending && onClose()} title="Editar proposta">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-mono">Cliente</span>
          <input className={campo} value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </label>
        <label className="block">
          <span className="label-mono">NIF</span>
          <input className={campo} value={nif} onChange={(e) => setNif(e.target.value)} />
        </label>
        <label className="block">
          <span className="label-mono">Segmento</span>
          <input className={campo} value={segmento} onChange={(e) => setSegmento(e.target.value)} />
        </label>
        <label className="block">
          <span className="label-mono">Poupança (€/ano)</span>
          <input
            className={campo}
            value={poupanca}
            inputMode="decimal"
            onChange={(e) => setPoupanca(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-mono">Plano</span>
          <input className={campo} value={plano} onChange={(e) => setPlano(e.target.value)} />
        </label>
      </div>

      {!valido && <p className="mt-2 text-[12.5px] text-danger">A poupança tem de ser um número.</p>}
      {guardar.error && <p className="mt-2 text-[12.5px] text-danger">{errMsg(guardar.error)}</p>}

      {sim && (
        <div className="mt-4 rounded-lg border border-line bg-bg/60 p-3">
          <div className="text-[13px] font-medium">Contas do simulador</div>
          <p className="mt-1 text-[12px] text-ink-3">
            Os valores calculados só mudam no simulador. Abrir reabre esta proposta com tudo preenchido; ao gravar,
            substitui esta mesma proposta.
          </p>
          <a
            className="btn btn-ghost mt-2.5 h-8 px-3 text-[12.5px]"
            href={`${sim.href}?proposta=${encodeURIComponent(proposta!.id)}`}
            title={`Abrir no ${sim.nome}`}
          >
            <SlidersHorizontal size={13} /> Abrir no {sim.nome}
          </a>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" disabled={guardar.isPending} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={guardar.isPending || !valido}
          onClick={() =>
            proposta &&
            guardar.mutate({
              id: proposta.id,
              clientName: cliente,
              clientNif: nif,
              segment: segmento,
              bestPlan: plano,
              saving: num ?? 0,
            })
          }
        >
          {guardar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
        </button>
      </div>
    </Modal>
  );
}

/** Botão de lápis usado na lista. */
export function BotaoEditar({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-icon" aria-label="Editar proposta" title="Editar proposta" onClick={onClick}>
      <Pencil size={14} />
    </button>
  );
}
