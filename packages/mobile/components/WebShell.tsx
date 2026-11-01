import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

/**
 * Carregamento completo da plataforma web (D2D Consulting) dentro de um WebView
 * autenticado. O utilizador inicia sessão uma única vez dentro da própria app
 * (email/palavra-passe ou Google) e a sessão fica guardada na cookie store — tudo
 * o que se faz no site está disponível aqui, incluindo o terreno D2D.
 *
 * O WebView do Android guarda o index.html em cache por tempo indeterminado.
 * Como a app é instalada e vive meses, ficava a mostrar um build antigo depois
 * de cada publicação («o servidor não fez esta atualização»). Os cabeçalhos
 * no-cache abaixo obrigam a revalidar o HTML em cada abertura; os ficheiros do
 * build têm hash no nome, por isso continuam a poder ser guardados em cache.
 */
export function WebShell({ url }: { url: string }) {
  return (
    <WebView
      source={{
        uri: url,
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
      }}
      style={styles.webview}
      javaScriptEnabled
      domStorageEnabled
      // Sem cache no WebView: obriga a ir buscar o HTML novo a cada arranque.
      cacheEnabled={false}
      cacheMode="LOAD_NO_CACHE"
      startInLoadingState
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsBackForwardNavigationGestures
      originWhitelist={["*"]}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1 },
});
