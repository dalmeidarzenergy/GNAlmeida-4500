import { Scale } from "lucide-react";
import { PageHeader, Empty } from "../components/ui/kit";
import { useMe } from "../queries/me";

export default function RegrasPage() {
  const me = useMe();
  const canEdit = me.data?.permissions?.["regras"]?.edit ?? false;

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        eyebrow="Pagamentos"
        title="Regras"
        subtitle="Regras de pagamento dos autos."
      />
      <div className="card">
        <Empty
          title="Ainda sem regras"
          text={canEdit ? "A estrutura está pronta. Falta definir o que esta aba deve fazer." : "Ainda não há regras definidas."}
        />
      </div>
    </div>
  );
}
