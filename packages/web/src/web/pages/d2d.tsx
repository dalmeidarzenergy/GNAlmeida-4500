import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useMe } from "../queries/me";

/**
 * Terreno D2D — integra a página standalone (public/d2d.html) num iframe
 * em ecrã inteiro. A página assume o papel de quem está autenticado:
 *   - vendedor → "comercial" (regista portas, fecha o turno)
 *   - qualquer outro perfil (admin, rh, chefe, …) → "chefe" (vê a equipa)
 * O utilizador e o endpoint /api/d2d são passados por postMessage assim que
 * o iframe carrega, por isso nunca há dados de outro utilizador em cache.
 *
 * `?view=caixa` abre diretamente a caixa de mensagens (deep-link).
 */
export default function D2DPage() {
  const me = useMe();
  const ref = useRef<HTMLIFrameElement>(null);
  const user = me.data;
  const initialView = useRef<string | null>(new URLSearchParams(window.location.search).get("view"));
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

    // Envia a identidade exatamente uma vez e só quando o iframe está pronto —
    // senão o postMessage imediato perde-se (o listener ainda não montou) e o
    // deep-link `?view=caixa` nunca chega a aplicar a vista.
    const post = () => {
      if (!viewSent.current && initialView.current) {
        iframe.contentWindow?.postMessage({ ...base, view: initialView.current }, "*");
        viewSent.current = true;
      } else {
        iframe.contentWindow?.postMessage(base, "*");
      }
      const theme = localStorage.getItem("theme") || "dark";
      iframe.contentWindow?.postMessage({ type: "theme", theme }, "*");
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
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute("data-theme") || "dark";
      ref.current?.contentWindow?.postMessage({ type: "theme", theme }, "*");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  if (user === undefined) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-volt" />
      </div>
    );
  }

  return (
    <div className="-mx-5 -my-8 h-[100dvh] lg:-mx-8">
      <iframe
        ref={ref}
        src="/d2d.html"
        title="Terreno D2D"
        allow="geolocation"
        className="h-full w-full border-0"
      />
    </div>
  );
}
