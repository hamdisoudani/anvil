import { ChatApp } from "@/components/chat-app";
import { ChatErrorBoundary } from "@/components/error-boundary";

// Server Component shell — keeps the route static/light and hands
// interactivity to a single Client Component boundary.
export default function HomePage() {
  // Anvil Perplexity is served on the same origin as the chat UI, so
  // an empty baseUrl means "use the current host". This matches the
  // backend at /tasks and /perplexity/stream/*.
  const baseUrl = process.env.NEXT_PUBLIC_ANVIL_BASE_URL ?? "";
  return (
    <main className="h-dvh w-full">
      <ChatErrorBoundary>
        <ChatApp baseUrl={baseUrl} />
      </ChatErrorBoundary>
    </main>
  );
}