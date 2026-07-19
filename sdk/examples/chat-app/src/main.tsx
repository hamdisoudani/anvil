import React from "react";
import { createRoot } from "react-dom/client";
import { AnvilProvider, AnvilChat, useFrontendTool } from "@anvil/react";
import "@anvil/react/styles.css";

function App() {
  // Declare a frontend tool: get current time
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

  // Another frontend tool: open a URL
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

  // A simple custom render — show a chip with the current URL when opened
  return (
    <AnvilProvider baseUrl="/api">
      <div style={{ maxWidth: 720, margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
        <header style={{ padding: "16px 24px", borderBottom: "1px solid #e5e5e5" }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>🔨 Anvil</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
            Agent engine + React SDK demo. Try:{" "}
            <em>"What time is it?"</em> or <em>"Open github.com"</em>
          </p>
        </header>
        <AnvilChat
          placeholder="Ask anything…"
          style={{ flex: 1 }}
        />
      </div>
    </AnvilProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
