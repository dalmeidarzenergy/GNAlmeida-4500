/**
 * Simulador Iberdrola — carrega a página standalone (public/simulador-iberdrola.html)
 * num iframe em ecrã inteiro. Passa os dados do utilizador autenticado via postMessage
 * para que o simulador os use como dados do comercial e para o histórico centralizado.
 */
import { useEffect, useRef } from "react";
import { useMe } from "../queries/me";

export default function SimuladorPage() {
  const { data: me } = useMe();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!me || !iframeRef.current?.contentWindow) return;
    const t = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "rz-user",
          user: {
            name: me.name ?? "",
            email: me.email ?? "",
            phone: me.employee?.phone ?? me.phone ?? "",
            role: me.role,
            employeeId: me.employeeId,
          },
        },
        location.origin,
      );
    }, 400);
    return () => clearTimeout(t);
  }, [me]);

  // Envia tema inicial e escuta mudanças
  useEffect(() => {
    const sendTheme = () => {
      const theme = document.documentElement.getAttribute("data-theme") || "dark";
      iframeRef.current?.contentWindow?.postMessage({ type: "theme", theme }, location.origin);
    };
    sendTheme();
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="-mx-5 -my-8 h-[100dvh] lg:-mx-8">
      <iframe
        ref={iframeRef}
        src="/simulador-iberdrola.html"
        title="Simulador Iberdrola"
        className="h-full w-full border-0"
        allow="geolocation"
      />
    </div>
  );
}