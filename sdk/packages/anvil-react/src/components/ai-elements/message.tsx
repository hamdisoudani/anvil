"use client";

/**
 * AI Elements-style Message components.
 *
 * Self-contained, shadcn-based. No external deps.
 *
 * Usage:
 *   <Message from="user">
 *     <MessageAvatar name="You" />
 *     <MessageContent>{text}</MessageContent>
 *   </Message>
 *   <Message from="assistant">
 *     <MessageAvatar name="AI" />
 *     <MessageContent variant="contained">
 *       <Response>{text}</Response>
 *     </MessageContent>
 *   </Message>
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { Avatar, AvatarFallback } from "../ui/avatar";

type MessageRole = "user" | "assistant" | "system" | "tool";

interface MessageContextValue {
  from: MessageRole;
}

const MessageContext = React.createContext<MessageContextValue | null>(null);

function useMessage() {
  const ctx = React.useContext(MessageContext);
  if (!ctx) throw new Error("useMessage must be used within <Message>");
  return ctx;
}

interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: MessageRole;
}

export function Message({ from, className, children, ...props }: MessageProps) {
  return (
    <MessageContext.Provider value={{ from }}>
      <div
        className={cn(
          "group flex w-full items-start gap-2 sm:gap-3 py-2 sm:py-3",
          from === "user" && "flex-row-reverse",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </MessageContext.Provider>
  );
}

interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "contained" | "flat";
}

export function MessageContent({
  variant = "contained",
  className,
  children,
  ...props
}: MessageContentProps) {
  const { from } = useMessage();
  return (
    <div
      className={cn(
        "flex-1 min-w-0 text-sm leading-relaxed",
        from === "user" && "max-w-[85%] sm:max-w-[75%]",
        variant === "contained" &&
          cn(
            "rounded-2xl px-3 sm:px-4 py-2 sm:py-3",
            from === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50",
          ),
        variant === "flat" && "py-1",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface MessageAvatarProps {
  src?: string;
  name: string;
  className?: string;
}

export function MessageAvatar({ name, className }: MessageAvatarProps) {
  const { from } = useMessage();
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Avatar
      className={cn("h-7 w-7 sm:h-8 sm:w-8 shrink-0", className)}
    >
      <AvatarFallback
        className={cn(
          "text-[10px] sm:text-xs font-medium",
          from === "user"
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {initials || (from === "user" ? "U" : "AI")}
      </AvatarFallback>
    </Avatar>
  );
}
