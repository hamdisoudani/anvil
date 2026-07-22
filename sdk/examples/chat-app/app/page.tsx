import { ChatApp } from "@/components/chat-app";

// Server Component shell — keeps the route static/light and hands
// interactivity to a single Client Component boundary.
export default function HomePage() {
  const baseUrl = process.env.NEXT_PUBLIC_ANVIL_BASE_URL ?? "";
  return (
    <main className="h-dvh w-full">
      <ChatApp baseUrl={baseUrl} />
    </main>
  );
}
