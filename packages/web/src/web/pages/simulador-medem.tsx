/**
 * Simulador Medem (BTE / MT) — carrega a página standalone (public/simulador-medem.html)
 * num iframe em ecrã inteiro. É um simulador 100% manual: não vai buscar nada às
 * campanhas. Passa apenas o tema para o iframe acompanhar a app.
 */
import { useEffect, useRef } from "react";

/** Repassa o `?proposta=<id>` do URL da app para o iframe, para o simulador
 *  reabrir a proposta guardada em vez de arrancar em branco. */
function srcComProposta(base: string): string {
  if (typeof window === "undefined") return base;
  const id = new URLSearchParams(window.location.search).get("proposta");
  return id ? `${base}?proposta=${encodeURIComponent(id)}` : base;
}

export default function SimuladorMedemPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Propaga o tema atual para o iframe (o simulador é autónomo, só precisa do tema)
  useEffect(() => {
    const sendTheme = () => {
      const theme = document.documentElement.getAttribute("data-theme") || "light";
      iframeRef.current?.contentWindow?.postMessage({ type: "theme", theme }, location.origin);
    };
    sendTheme();
    iframeRef.current?.addEventListener("load", sendTheme);
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      iframeRef.current?.removeEventListener("load", sendTheme);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="-mx-4 -my-8 h-[100dvh] overflow-x-hidden lg:-mx-8">
      <iframe
        ref={iframeRef}
        src={srcComProposta("/simulador-medem.html")}
        title="Simulador Medem"
        className="h-full w-full border-0"
      />
    </div>
  );
}
