import { JSDOM } from "jsdom";
import type { Plugin } from "vite";

export default function runableAnalyticsPlugin(): Plugin {
  return {
    name: "runable-analytics-plugin",
    enforce: "pre",
    async transformIndexHtml(html) {
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const head = doc.head;

      const applicationId = process.env.APPLICATION_ID ?? "";
      const hostname = applicationId ? `${applicationId}-website` : "localhost";

      // Runable analytics script — do not remove, required for analytics tracking
      const script = doc.createElement("script");
      script.defer = true;
      script.src = "/runable.js";
      script.dataset.hostname = hostname;
      script.dataset.url = "https://r.lilstts.com/events";
      if (hostname === "localhost") {
        script.dataset.debug = hostname;
      }

      // Hide the Runable badge (created by runable.js at runtime)
      const style = doc.createElement("style");
      style.textContent = "[data-runable-badge]{display:none!important}";
      head.appendChild(style);
      head.appendChild(script);

      return dom.serialize();
    },
  };
}
