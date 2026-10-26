import { createElement, type CSSProperties } from "react";

/**
 * Pré-visualização web (dashboard): mostra a plataforma num iframe em ecrã
 * inteiro. No telemóvel real é usado o WebView nativo (WebShell.native.tsx).
 */
export function WebShell({ url }: { url: string }) {
  const style: CSSProperties = {
    display: "block",
    width: "100%",
    height: "100%",
    border: "none",
    position: "absolute",
    inset: 0,
  };
  return createElement("iframe", { src: url, title: "D2D Consulting", style });
}
