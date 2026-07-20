/**
 * Sources — collapsible citation list.
 *
 * Default: collapsed, shows "N sources" trigger.
 * Opens to show a list of <Source> items with title + domain.
 * Auto-opens when `autoOpen` is true (use this for completed assistant turns).
 */
import * as React from "react";
interface SourcesProps extends React.HTMLAttributes<HTMLDivElement> {
    autoOpen?: boolean;
    defaultOpen?: boolean;
    count?: number;
}
export declare function Sources({ autoOpen, defaultOpen, className, children, ...props }: SourcesProps): React.JSX.Element;
interface SourcesTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    count?: number;
}
export declare function SourcesTrigger({ open, onOpenChange, count, className, ...props }: SourcesTriggerProps): React.JSX.Element;
interface SourcesContentProps extends React.HTMLAttributes<HTMLDivElement> {
    open?: boolean;
}
export declare function SourcesContent({ open, className, children, ...props }: SourcesContentProps): React.JSX.Element | null;
interface SourceProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
    title?: string;
    domain?: string;
}
export declare function Source({ href, title, domain, className, children, ...props }: SourceProps): React.JSX.Element;
export {};
//# sourceMappingURL=sources.d.ts.map