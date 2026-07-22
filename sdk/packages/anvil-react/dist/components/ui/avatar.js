"use client";
import { jsx as _jsx } from "react/jsx-runtime";
// shadcn/ui-style Avatar component.
import * as React from "react";
import { cn } from "../../lib/utils";
const Avatar = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn("relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full", className), ...props })));
Avatar.displayName = "Avatar";
const AvatarImage = React.forwardRef(({ className, ...props }, ref) => (
// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
_jsx("img", { ref: ref, className: cn("aspect-square h-full w-full", className), ...props })));
AvatarImage.displayName = "AvatarImage";
const AvatarFallback = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn("flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-medium", className), ...props })));
AvatarFallback.displayName = "AvatarFallback";
export { Avatar, AvatarImage, AvatarFallback };
//# sourceMappingURL=avatar.js.map