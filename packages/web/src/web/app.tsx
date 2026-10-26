import { Suspense, lazy } from "react";
import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { Protected } from "./components/protected";
import SignInPage from "./pages/sign-in";
import Dashboard from "./pages/index";

/** Páginas carregadas só quando abertas (code-splitting), para o bundle inicial ficar leve. */
const EmployeesPage = lazy(() => import("./pages/employees"));
const DepartmentsPage = lazy(() => import("./pages/departments"));
const TeamsPage = lazy(() => import("./pages/teams"));
const AbsencesPage = lazy(() => import("./pages/absences"));
const RecruitmentPage = lazy(() => import("./pages/recruitment"));
const ClientsPage = lazy(() => import("./pages/clients"));
const SalesPage = lazy(() => import("./pages/sales"));
const CriticalSalesPage = lazy(() => import("./pages/critical-sales"));
const VtvStatusPage = lazy(() => import("./pages/vtv-status"));
const SaleSummaryPage = lazy(() => import("./pages/sale-summary"));
const SalesImportPage = lazy(() => import("./pages/sales-import"));
const TargetsPage = lazy(() => import("./pages/targets"));
const CampaignsPage = lazy(() => import("./pages/campaigns"));
const ReportsPage = lazy(() => import("./pages/reports"));
const EvolutionPage = lazy(() => import("./pages/evolution"));
const ComparisonPage = lazy(() => import("./pages/comparison"));
const MedemPage = lazy(() => import("./pages/medem"));
const CommissionTablesPage = lazy(() => import("./pages/commission-tables"));
const PaymentsPage = lazy(() => import("./pages/payments"));
const IberdrolaPage = lazy(() => import("./pages/iberdrola"));
const RegrasPage = lazy(() => import("./pages/regras"));
const IncentivosPage = lazy(() => import("./pages/incentivos"));
const UsersPage = lazy(() => import("./pages/users"));
const AgendaPage = lazy(() => import("./pages/agenda"));
const D2DPage = lazy(() => import("./pages/d2d"));
const SimuladorPage = lazy(() => import("./pages/simulador"));
const CompletarIbanPage = lazy(() => import("./pages/completar-iban"));

const routes: [string, React.ComponentType][] = [
  ["/agenda", AgendaPage],
  ["/funcionarios", EmployeesPage],
  ["/departamentos", DepartmentsPage],
  ["/equipas", TeamsPage],
  ["/ausencias", AbsencesPage],
  ["/recrutamento", RecruitmentPage],
  ["/tabelas-comissionais", CommissionTablesPage],
  ["/pagamentos", PaymentsPage],
  ["/auto-iberdrola", IberdrolaPage],
  ["/regras", RegrasPage],
  ["/incentivos", IncentivosPage],
  ["/clientes", ClientsPage],
  ["/vendas/importar", SalesImportPage],
  ["/vendas", SalesPage],
  ["/vendas-criticas", CriticalSalesPage],
  ["/estado-vtv", VtvStatusPage],
  ["/venda/:id", SaleSummaryPage],
  ["/campanhas", CampaignsPage],
  ["/metas", TargetsPage],
  ["/relatorios", ReportsPage],
  ["/evolucao", EvolutionPage],
  ["/comparativo", ComparisonPage],
  ["/medem", MedemPage],
  ["/utilizadores", UsersPage],
  ["/terreno-d2d", D2DPage],
  ["/simulador-iberdrola", SimuladorPage],
  ["/completar-iban", CompletarIbanPage],
  ["/", Dashboard],
];

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/entrar" component={SignInPage} />
        {routes.map(([path, C]) => (
          <Route key={path} path={path}>
            <Protected>
              <Suspense fallback={null}>
                <C />
              </Suspense>
            </Protected>
          </Route>
        ))}
        <Route>
          <Protected>
            <Dashboard />
          </Protected>
        </Route>
      </Switch>
    </Provider>
  );
}

export default App;
