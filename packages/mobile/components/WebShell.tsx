import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

/**
 * Carregamento completo da plataforma web (D2D Consulting) dentro de um WebView
 * autenticado. O utilizador inicia sessão uma única vez dentro da própria app
 * (email/palavra-passe ou Google) e a sessão fica guardada na cookie store — tudo
 * o que se faz no site está disponível aqui, incluindo o terreno D2D.
 */
export function WebShell({ url }: { url: string }) {
  return (
    <WebView
      source={{ uri: url }}
      style={styles.webview}
      javaScriptEnabled
      domStorageEnabled
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
