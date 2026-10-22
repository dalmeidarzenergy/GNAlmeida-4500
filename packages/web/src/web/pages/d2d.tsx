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
 */
export default function D2DPage() {
  const me = useMe();
  const ref = useRef<HTMLIFrameElement>(null);
  const user = me.data;

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe || !user) return;
    const role = user.role === "vendedor" ? "comercial" : "chefe";
    const payload = {
      type: "d2d:user",
      endpoint: "/api/d2d",
      user: { id: user.id, name: user.name || user.email || "", role },
    };
    const send = () => iframe.contentWindow?.postMessage(payload, "*");
    iframe.addEventListener("load", send);
    // No caso de o iframe já ter carregado quando o `me` chegar, envia já.
    send();
    return () => iframe.removeEventListener("load", send);
  }, [user]);

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
