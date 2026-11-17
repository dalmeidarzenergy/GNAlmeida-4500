import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invalidarContas } from "../queries/conta";

const queryClient = new QueryClient({
  // Qualquer escrita pode mexer num número que outra página soma: valores de uma
  // tabela comissional mudam a previsão, um ficheiro muda o auto final, um
  // salário muda as despesas. Em vez de confiar que cada mutação se lembra de
  // todas as vistas afectadas, invalida-se aqui as que partilham os mesmos dados.
  mutationCache: new MutationCache({
    onSuccess: () => invalidarContas(queryClient),
  }),
  defaultOptions: {
    queries: {
      // Evita refetch em cada mudança de foco/aba e dá 30s de frescura — a UI fica
      // muito mais responsiva; os dados continuam a invalidar-se nas mutações.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

interface ProviderProps {
  children: React.ReactNode;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
export function Provider({ children }: ProviderProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
