"use client";

/**
 * Sources — collapsible citation list.
 *
 * Default: collapsed, shows "N sources" trigger.
 * Opens to show a list of <Source> items with title + domain.
 * Auto-opens when `autoOpen` is true (use this for completed assistant turns).
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, ExternalLink } from "lucide-react";

interface Source {
  href: string;
  title?: string;
  domain?: string;
}

const SourcesContext = React.createContext<{ autoOpen: boolean } | null>(null);

function useSources() {
  const ctx = React.useContext(SourcesContext);
  return ctx ?? { autoOpen: false };
}

interface SourcesProps extends React.HTMLAttributes<HTMLDivElement> {
  autoOpen?: boolean;
  defaultOpen?: boolean;
  count?: number;
}

export function Sources({
  autoOpen = false,
  defaultOpen,
  className,
  children,
  ...props
}: SourcesProps) {
  const [open, setOpen] = React.useState(defaultOpen ?? autoOpen);
  // Re-sync when autoOpen flips (e.g. on completion)
  React.useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  return (
    <SourcesContext.Provider value={{ autoOpen }}>
      <div className={cn("mt-2", className)} {...props}>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child) && child.type === SourcesTrigger) {
            return React.cloneElement(child as React.ReactElement<{ open?: boolean; onOpenChange?: (o: boolean) => void }>, {
              open,
              onOpenChange: setOpen,
            });
          }
          if (React.isValidElement(child) && child.type === SourcesContent) {
            return React.cloneElement(child as React.ReactElement<{ open?: boolean }>, { open });
          }
          return child;
        })}
      </div>
    </SourcesContext.Provider>
  );
}

interface SourcesTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  count?: number;
}

export function SourcesTrigger({ open, onOpenChange, count, className, ...props }: SourcesTriggerProps) {
  return (
    <button
      type="button"
      onClick={() => onOpenChange?.(!open)}
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
      {...props}
    >
      <ChevronRight
        className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
      />
      {count !== undefined ? `${count} source${count === 1 ? "" : "s"}` : "Sources"}
    </button>
  );
}

interface SourcesContentProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
}

export function SourcesContent({ open, className, children, ...props }: SourcesContentProps) {
  if (!open) return null;
  return (
    <div
      className={cn(
        "mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1 pl-2 border-l-2 border-muted",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface SourceProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  title?: string;
  domain?: string;
}

export function Source({ href, title, domain, className, children, ...props }: SourceProps) {
  const displayTitle = title ?? children ?? href;
  const inferredDomain = React.useMemo(() => {
    if (domain) return domain;
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return href;
    }
  }, [domain, href]);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex items-start gap-1.5 rounded px-1.5 py-1 text-[10px] sm:text-xs hover:bg-accent/40 transition-colors",
        className,
      )}
      {...props}
    >
      <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{displayTitle}</div>
        <div className="truncate text-muted-foreground text-[9px] sm:text-[10px]">
          {inferredDomain}
        </div>
      </div>
    </a>
  );
}
