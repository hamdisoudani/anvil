/**
 * Actions — message-level action buttons (copy, retry, like).
 * Appears on hover, sticky to bottom of message.
 */
import * as React from "react";
import { Button } from "../ui/button";
interface ActionsProps extends React.HTMLAttributes<HTMLDivElement> {
}
export declare function Actions({ className, children, ...props }: ActionsProps): React.JSX.Element;
interface ActionProps extends React.ComponentProps<typeof Button> {
    tooltip?: string;
    label: string;
    icon: React.ComponentType<{
        className?: string;
    }>;
    onClick?: () => void;
}
export declare function Action({ tooltip, label, icon: Icon, className, ...props }: ActionProps): React.JSX.Element;
export {};
//# sourceMappingURL=actions.d.ts.map