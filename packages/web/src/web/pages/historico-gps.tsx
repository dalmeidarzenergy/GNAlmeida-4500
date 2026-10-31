import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useMe } from "../queries/me";

/**
 * Histórico GPS — abre a página standalone (public/d2d.html) num iframe em ecrã
 * inteiro, já posicionada na vista "ter" com a sub-aba Histórico GPS ativa.
 *
 * É o mesmo iframe do Terreno D2D (partilha a identidade por postMessage); a
 * única diferença é o deep-link inicial. `?dia=YYYY-MM-DD` e `?mes=YYYY-MM`
 * pré-filtram o período.
 */
export default function HistoricoGpsPage() {
  const me = useMe();
  const ref = useRef<HTMLIFrameElement>(null);
  const user = me.data;
  const params = useRef(new URLSearchParams(window.location.search));
  const viewSent = useRef(false);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe || !user) return;
    const role = user.role === "vendedor" ? "comercial" : "chefe";
    const base = {
      type: "d2d:user",
      endpoint: "/api/d2d",
      user: { id: user.id, name: user.name || user.email || "", role },
    };

    const post = () => {
      const msg: Record<string, unknown> = { ...base, view: "ter", sub: "hist" };
      const dia = params.current.get("dia");
      const mes = params.current.get("mes");
      if (dia) msg.dia = dia;
      if (mes) msg.mes = mes;
      iframe.contentWindow?.postMessage(msg, "*");
      const theme = localStorage.getItem("theme") || "dark";
      iframe.contentWindow?.postMessage({ type: "theme", theme }, "*");
      viewSent.current = true;
    };

    let ready = false;
    try {
      const doc = iframe.contentDocument;
      ready = !!doc && doc.readyState === "complete" && doc.location.href !== "about:blank";
    } catch (_) {
      ready = false;
    }

    if (ready) post();
    else iframe.addEventListener("load", post);
    return () => iframe.removeEventListener("load", post);
  }, [user]);

  // Escuta mudanças de tema e propaga ao iframe
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // Reserva a altura da barra de endereço em telemóveis (visualViewport).
      const vv = window.visualViewport;
      const bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      el.contentWindow?.postMessage({ type: "safe-area", bottom }, "*");
    };
    const onTheme = (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme || localStorage.getItem("theme") || "dark";
      ref.current?.contentWindow?.postMessage({ type: "theme", theme }, "*");
    };
    window.addEventListener("themechange", onTheme);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      window.removeEventListener("themechange", onTheme);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-volt" />
      </div>
    );
  }

  return (
    <div
      className="-mx-4 -my-8 overflow-x-hidden lg:-mx-8"
      style={{ height: "calc(100dvh - 5.5rem)" }}
    >
      <iframe
        ref={ref}
        src="/d2d.html"
        title="Histórico GPS"
        allow="geolocation"
        className="h-full w-full border-0"
      />
    </div>
  );
}
