import { createRoot } from "react-dom/client";
import { AnvilProvider, AnvilPerplexity, useFrontendTool } from "@anvil/react";
import "./index.css";

// Tools must be registered INSIDE <AnvilProvider>.
// This wrapper component handles that.
function AppContent() {
  useFrontendTool<{ tz?: string }, string>({
    name: "get_current_time",
    description: "Returns the current time. Use whenever the user asks about the time, date, or when something happened.",
    inputSchema: {
      type: "object",
      properties: {
        tz: { type: "string", description: "Timezone, e.g. 'UTC', 'America/New_York'. Omit for local time." },
      },
    },
    execute: ({ tz }) => {
      const now = tz ? new Date().toLocaleString("en-US", { timeZone: tz }) : new Date().toLocaleString();
      return now;
    },
  });

  useFrontendTool<{ url: string; newTab?: boolean }, string>({
    name: "open_url",
    description: "Open a URL in the browser. Use when the user asks to navigate, view, or open a link.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL, e.g. https://example.com" },
        newTab: { type: "boolean", description: "Open in a new tab (default: false)" },
      },
      required: ["url"],
    },
    execute: ({ url, newTab = false }) => {
      if (newTab) window.open(url, "_blank", "noopener");
      else window.location.href = url;
      return `opened ${url}`;
    },
  });

  return <AnvilPerplexity />;
}

function App() {
  return (
    <AnvilProvider baseUrl="">
      <AppContent />
    </AnvilProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
