// Completes a returning managed sign-in before the app mounts (top-level await
// delays the sibling ./__main import until this resolves).
import { authClient } from "./auth";

await authClient.managedAuth.handleRedirect();
