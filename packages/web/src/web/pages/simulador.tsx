/**
 * Simulador Iberdrola — carrega a página standalone (public/simulador-iberdrola.html)
 * num iframe em ecrã inteiro. A página comunica com /api/ai e /api/campanhas.
 * O iframe é a maneira mais fiável de integrar o simulador sem alterar o código fonte
 * (conforme as instruções: "NÃO o reescrevas").
 */
export default function SimuladorPage() {
  return (
    <div className="-mx-5 -my-8 h-[100dvh] lg:-mx-8">
      <iframe
        src="/simulador-iberdrola.html"
        title="Simulador Iberdrola"
        className="h-full w-full border-0"
        allow="geolocation"
      />
    </div>
  );
}