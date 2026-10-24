import { Sparkles } from "lucide-react";
import { PageHeader, Empty } from "../components/ui/kit";
import { useMe } from "../queries/me";

export default function IncentivosPage() {
  const me = useMe();
  const canEdit = me.data?.permissions?.["incentivos"]?.edit ?? false;

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        eyebrow="Pagamentos"
        title="Incentivos"
        subtitle="Incentivos atribuídos aos comerciais."
      />
      <div className="card">
        <Empty
          title="Ainda sem incentivos"
          text={canEdit ? "A estrutura está pronta. Falta definir o que esta aba deve fazer." : "Ainda não há incentivos definidos."}
        />
      </div>
    </div>
  );
}
