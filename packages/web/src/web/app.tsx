import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { Protected } from "./components/protected";
import SignInPage from "./pages/sign-in";
import Dashboard from "./pages/index";
import EmployeesPage from "./pages/employees";
import DepartmentsPage from "./pages/departments";
import TeamsPage from "./pages/teams";
import AbsencesPage from "./pages/absences";
import RecruitmentPage from "./pages/recruitment";
import ClientsPage from "./pages/clients";
import SalesPage from "./pages/sales";
import SalesImportPage from "./pages/sales-import";
import TargetsPage from "./pages/targets";
import CampaignsPage from "./pages/campaigns";
import ReportsPage from "./pages/reports";
import EvolutionPage from "./pages/evolution";
import UsersPage from "./pages/users";
import AgendaPage from "./pages/agenda";
import D2DPage from "./pages/d2d";
import SimuladorPage from "./pages/simulador";

const routes: [string, React.ComponentType][] = [
  ["/agenda", AgendaPage],
  ["/funcionarios", EmployeesPage],
  ["/departamentos", DepartmentsPage],
  ["/equipas", TeamsPage],
  ["/ausencias", AbsencesPage],
  ["/recrutamento", RecruitmentPage],
  ["/clientes", ClientsPage],
  ["/vendas/importar", SalesImportPage],
  ["/vendas", SalesPage],
  ["/campanhas", CampaignsPage],
  ["/metas", TargetsPage],
  ["/relatorios", ReportsPage],
  ["/evolucao", EvolutionPage],
  ["/utilizadores", UsersPage],
  ["/terreno-d2d", D2DPage],
  ["/simulador-iberdrola", SimuladorPage],
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
              <C />
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
