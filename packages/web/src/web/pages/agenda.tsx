import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { PageHeader, Modal, Field, Empty } from "../components/ui/kit";
import { MonthYearFilter } from "../components/month-year-filter";
import { useMe } from "../queries/me";
import { useCalendars, useAgendaEvents, useEventMutations } from "../queries/agenda";

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => toKey(new Date());

type Cal = { id: number; type: string; teamId: number | null; color: string; ownerUserId: string | null; ownerName: string | null; teamName: string | null; active: boolean };
type Ev = { id: number; calendarId: number; title: string; date: string; startTime: string; endTime: string | null; notes: string | null; clientName: string | null; createdBy: string | null; createdByName: string | null; updatedByName: string | null };

function calLabel(c: Cal) {
  return c.type === "equipa" ? `Equipa · ${c.teamName ?? "—"}` : (c.ownerName ?? "Pessoal");
}

export default function AgendaPage() {
  const me = useMe();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(todayKey());
  const [teamFilter, setTeamFilter] = useState<number | null>(null); // teamId
  const [personFilter, setPersonFilter] = useState<number | null>(null); // calendarId pessoal
  const [modal, setModal] = useState<null | { ev?: Ev; date?: string }>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthKey = `${year}-${pad(month + 1)}`;
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${pad(new Date(year, month + 1, 0).getDate())}`;

  const cals = useCalendars();
  const events = useAgendaEvents(from, to);
  const mut = useEventMutations();

  const calList = useMemo(() => cals.data ?? [], [cals.data]);
  const teamCals = calList.filter((c) => c.type === "equipa");
  const personCals = calList.filter((c) => c.type === "pessoal" && (teamFilter == null || c.teamId === teamFilter));
  /** Calendários incluídos no filtro atual (null = todos os visíveis). */
  const allowed = useMemo(() => {
    if (personFilter != null) return new Set([personFilter]);
    if (teamFilter != null) return new Set(calList.filter((c) => c.teamId === teamFilter).map((c) => c.id));
    return null;
  }, [personFilter, teamFilter, calList]);

  const calById = useMemo(() => new Map(calList.map((c) => [c.id, c])), [calList]);
  const byDate = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of (events.data ?? []).filter((e) => allowed == null || allowed.has(e.calendarId))) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [events.data, allowed]);

  // Grelha do mês (começa na segunda-feira).
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = segunda
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(year, month, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const dayEvents = byDate.get(selected) ?? [];
  const nav = (d: number) => setCursor(new Date(year, month + d, 1));

  const selLabel = (() => { const [y, m, d] = selected.split("-").map(Number); return `${d} de ${MONTH_NAMES[m - 1]} de ${y}`; })();

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Agenda" />

      {cals.data && cals.data.length === 0 && (
        <div className="card rise mb-4 p-6 text-[13.5px] text-ink-2">Ainda não tens calendários atribuídos. Fala com o teu responsável.</div>
      )}

      {/* Filtros: equipa, pessoa e mês/ano */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {calList.length > 1 && (
          <>
            <select aria-label="Equipa" className="input h-10 w-56" value={teamFilter ?? ""} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setTeamFilter(v); setPersonFilter(null); }}>
              <option value="">Todas as equipas</option>
              {teamCals.map((c) => <option key={c.id} value={c.teamId ?? c.id}>{c.teamName ?? "—"}</option>)}
            </select>
            <select aria-label="Pessoa" className="input h-10 w-56" value={personFilter ?? ""} onChange={(e) => setPersonFilter(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todas as pessoas</option>
              {personCals.map((c) => <option key={c.id} value={c.id}>{c.ownerName ?? "Pessoal"}</option>)}
            </select>
          </>
        )}
        <MonthYearFilter value={monthKey} onChange={(v) => { if (!v) return; const [y, m] = v.split("-").map(Number); setCursor(new Date(y, m - 1, 1)); }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Calendário */}
        <div className="card rise p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-[17px] font-semibold">{MONTH_NAMES[month]} de {year}</div>
            <div className="flex items-center gap-1">
              <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => nav(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
              <button className="btn btn-ghost h-8 px-3 text-[12.5px]" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(todayKey()); }}>Hoje</button>
              <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => nav(1)} aria-label="Mês seguinte"><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => <div key={w} className="label-mono pb-1 text-center text-[10.5px]">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const key = toKey(d);
              const evs = byDate.get(key) ?? [];
              const isSel = key === selected;
              const isToday = key === todayKey();
              return (
                <button
                  key={i}
                  onClick={() => setSelected(key)}
                  className={`flex min-h-[64px] flex-col items-start rounded-[10px] border p-1.5 text-left transition ${isSel ? "border-volt bg-volt/10" : "border-line/60 hover:bg-surface-2"}`}
                >
                  <span className={`num text-[12px] font-medium ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-volt text-[11px] text-black" : "text-ink-2"}`}>{d.getDate()}</span>
                  <div className="mt-1 flex w-full flex-col gap-0.5">
                    {evs.slice(0, 2).map((e) => (
                      <span key={e.id} className="truncate rounded px-1 py-px text-[10px] leading-tight text-black" style={{ background: calById.get(e.calendarId)?.color ?? "#c6f432" }}>
                        {e.startTime} {e.title}
                      </span>
                    ))}
                    {evs.length > 2 && <span className="px-1 text-[10px] text-ink-3">+{evs.length - 2}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Eventos do dia */}
        <div className="card rise p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-[15px] font-semibold">{selLabel}</div>
            <button className="btn btn-primary h-8 text-[12px]" onClick={() => setModal({ date: selected })}><Plus size={14} /> Adicionar</button>
          </div>
          {events.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-volt" /></div>
          ) : dayEvents.length === 0 ? (
            <Empty title="Sem eventos neste dia" />
          ) : (
            <div className="flex flex-col gap-2">
              {dayEvents.map((e) => {
                const c = calById.get(e.calendarId);
                const canDelete = me.data?.role !== "vendedor" || e.createdBy === me.data?.id;
                return (
                  <div key={e.id} className="rounded-[10px] border border-line/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color ?? "#c6f432" }} />
                          <span className="truncate text-[13.5px] font-medium">{e.title}</span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-ink-2">
                          {e.startTime}{e.endTime ? ` – ${e.endTime}` : ""} · {c ? calLabel(c) : ""}{e.clientName ? ` · ${e.clientName}` : ""}
                        </div>
                        {e.notes && <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">{e.notes}</div>}
                        {(e.createdByName || e.updatedByName) && (
                          <div className="mt-1.5 text-[11px] text-ink-3">
                            {e.createdByName && `Criado por ${e.createdByName}`}
                            {e.updatedByName && e.updatedByName !== e.createdByName && ` · alterado por ${e.updatedByName}`}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="btn btn-ghost h-7 w-7 p-0" onClick={() => setModal({ ev: e })} aria-label="Editar"><Pencil size={13} /></button>
                        {canDelete && (
                          <button className="btn btn-ghost h-7 w-7 p-0 text-danger" onClick={() => { if (confirm("Apagar este evento?")) mut.remove.mutate({ id: e.id }); }} aria-label="Apagar"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <EventModal
          ev={modal.ev}
          date={modal.date ?? selected}
          calendars={(cals.data ?? []).filter((c) => (me.data?.role === "vendedor" ? c.ownerUserId === me.data?.id : true))}
          defaultCalendarId={modal.ev?.calendarId ?? null}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            if (modal.ev) await mut.update.mutateAsync({ id: modal.ev.id, ...v });
            else await mut.create.mutateAsync(v as never);
            setModal(null);
          }}
          saving={mut.create.isPending || mut.update.isPending}
        />
      )}
    </div>
  );
}

function EventModal({ ev, date, calendars, defaultCalendarId, onClose, onSave, saving }: {
  ev?: Ev; date: string; calendars: Cal[]; defaultCalendarId: number | null;
  onClose: () => void; onSave: (v: { calendarId: number; title: string; date: string; startTime: string; endTime: string | null; notes: string | null; clientName: string | null }) => Promise<void>; saving: boolean;
}) {
  const [calendarId, setCalendarId] = useState<number>(defaultCalendarId ?? calendars[0]?.id ?? 0);
  const [title, setTitle] = useState(ev?.title ?? "");
  const [d, setD] = useState(ev?.date ?? date);
  const [startTime, setStartTime] = useState(ev?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(ev?.endTime ?? "");
  const [notes, setNotes] = useState(ev?.notes ?? "");
  const [clientName, setClientName] = useState(ev?.clientName ?? "");
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title={ev ? "Editar evento" : "Novo evento"}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!calendarId) { setErr("Escolha o calendário."); return; }
          try {
            await onSave({ calendarId, title: title.trim(), date: d, startTime, endTime: endTime || null, notes: notes.trim() || null, clientName: clientName.trim() || null });
          } catch (x) {
            setErr(x instanceof Error ? x.message : "Não foi possível guardar.");
          }
        }}
      >
        <Field label="Calendário">
          <select className="input" value={calendarId} onChange={(e) => setCalendarId(Number(e.target.value))} disabled={!!ev}>
            {calendars.map((c) => <option key={c.id} value={c.id}>{calLabel(c)}</option>)}
          </select>
        </Field>
        <Field label="Título"><input aria-label="Título" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Data"><input aria-label="Data" className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} required /></Field>
          <Field label="Início"><input aria-label="Início" className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></Field>
          <Field label="Fim (opcional)"><input aria-label="Fim" className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
        </div>
        <Field label="Cliente (opcional)">
          <input aria-label="Cliente" className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Escreve o nome do cliente" maxLength={200} />
        </Field>
        <Field label="Notas"><textarea aria-label="Notas" className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
        {err && <div className="text-[12.5px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
