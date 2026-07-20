"use client";

/**
 * Conversation — auto-scrolling chat container.
 *
 * Wraps messages in a flex column. When new content is added, scrolls
 * to bottom. The sticky "scroll to bottom" button appears when the
 * user has scrolled up.
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ArrowDown } from "lucide-react";
import { Button } from "../ui/button";

interface ConversationContextValue {
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

const ConversationContext = React.createContext<ConversationContextValue | null>(null);

export function useConversation() {
  return React.useContext(ConversationContext);
}

interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Conversation({ className, children, ...props }: ConversationProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 60;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
  }, []);

  // Auto-scroll on new content (only if user is already at bottom)
  React.useEffect(() => {
    if (isAtBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  return (
    <ConversationContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div className={cn("relative flex-1 min-h-0", className)} {...props}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto"
        >
          {children}
        </div>
        <ConversationScrollButton />
      </div>
    </ConversationContext.Provider>
  );
}

interface ConversationContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ConversationContent({ className, children, ...props }: ConversationContentProps) {
  return (
    <div className={cn("mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8", className)} {...props}>
      {children}
    </div>
  );
}

export function ConversationEmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground max-w-md">{description}</p>}
    </div>
  );
}

function ConversationScrollButton() {
  const ctx = useConversation();
  if (!ctx || ctx.isAtBottom) return null;
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={ctx.scrollToBottom}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 h-7 w-7 sm:h-8 sm:w-8 rounded-full shadow-md"
    >
      <ArrowDown className="h-3.5 w-3.5" />
    </Button>
  );
}
