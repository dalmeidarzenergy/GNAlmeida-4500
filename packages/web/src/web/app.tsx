import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
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
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
