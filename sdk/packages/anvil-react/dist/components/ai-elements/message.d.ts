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
type MessageRole = "user" | "assistant" | "system" | "tool";
interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
    from: MessageRole;
}
export declare function Message({ from, className, children, ...props }: MessageProps): React.JSX.Element;
interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "contained" | "flat";
}
export declare function MessageContent({ variant, className, children, ...props }: MessageContentProps): React.JSX.Element;
interface MessageAvatarProps {
    src?: string;
    name: string;
    className?: string;
}
export declare function MessageAvatar({ name, className }: MessageAvatarProps): React.JSX.Element;
export {};
//# sourceMappingURL=message.d.ts.map