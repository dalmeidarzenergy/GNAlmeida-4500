import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Bell, CheckCheck } from "lucide-react";
import { useNotifications, useMarkAllRead, useMarkRead } from "../queries/notifications";
import { fmtDate } from "../lib/format";

export function NotificationsBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-icon relative"
        aria-label="Notificações"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[320px] overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Notificações</span>
            {unread > 0 && (
              <button className="flex items-center gap-1 text-[11.5px] text-ink-2 hover:text-ink" onClick={() => markAll.mutate()}>
                <CheckCheck size={13} /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-ink-3">Sem notificações.</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-line/60 px-4 py-3 last:border-0 ${n.read ? "" : "bg-volt/5"}`}
                  onClick={() => { if (!n.read) markRead.mutate({ id: n.id }); }}
                >
                  {n.url ? (
                    <Link to={n.url} onClick={() => setOpen(false)} className="block">
                      <div className="text-[13px] font-medium leading-snug">{n.title}</div>
                      {n.body && <div className="mt-0.5 text-[12px] leading-snug text-ink-2">{n.body}</div>}
                      <div className="mt-1 text-[10.5px] text-ink-3">{fmtDate(n.createdAt)}</div>
                    </Link>
                  ) : (
                    <>
                      <div className={`text-[13px] font-medium leading-snug ${n.read ? "" : "text-ink"}`}>{n.title}</div>
                      {n.body && <div className="mt-0.5 text-[12px] leading-snug text-ink-2">{n.body}</div>}
                      <div className="mt-1 text-[10.5px] text-ink-3">{fmtDate(n.createdAt)}</div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
