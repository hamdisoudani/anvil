declare const FOCUS_MODES: readonly [{
    readonly id: "web";
    readonly label: "Web";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "academic";
    readonly label: "Academic";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "news";
    readonly label: "News";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "social";
    readonly label: "Social";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}];
type FocusMode = (typeof FOCUS_MODES)[number]["id"];
export interface AnvilPerplexityProps {
    className?: string;
    defaultFocus?: FocusMode;
}
export declare function AnvilPerplexity({ className, defaultFocus }: AnvilPerplexityProps): import("react").JSX.Element;
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool, type AnvilEvent } from "@anvil/react-headless";
//# sourceMappingURL=index.d.ts.map