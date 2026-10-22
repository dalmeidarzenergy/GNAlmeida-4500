import { View, StyleSheet } from "react-native";
import Constants from "expo-constants";
import { WebShell } from "../components/WebShell";

/**
 * A aplicação é um espelho da plataforma web: carrega o site em ecrã inteiro
 * dentro de um WebView autenticado, pelo que tudo o que se faz no site
 * (painéis, vendas, clientes, terreno D2D, metas…) está disponível na app.
 */
const rawBaseUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL;

const baseUrl = (rawBaseUrl ?? "https://rzenerg-ak5tvb9-preview-4200.runable.site").replace(/\/+$/, "");

export default function App() {
  return (
    <View style={styles.container}>
      <WebShell url={baseUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
