import { Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import type { SessionIndexStatus } from "@/shared/types/chat";

interface SessionActivityIndicatorProps {
  isRunning?: boolean;
  status?: SessionIndexStatus;
  hasUnread?: boolean;
  showIdle?: boolean;
  variant?: "inline" | "overlay";
  className?: string;
}

export function SessionActivityIndicator({
  isRunning = false,
  status,
  hasUnread = false,
  showIdle = false,
  variant = "inline",
  className,
}: SessionActivityIndicatorProps) {
  const runtimeStatus = status ?? (isRunning ? "running" : "idle");

  if (runtimeStatus === "running") {
    if (variant === "overlay") {
      return (
        <span
          role="status"
          aria-label="Chat active"
          className={cn(
            "absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center transition-opacity duration-200 ease-out animate-in fade-in-0",
            className,
          )}
        >
          <Loader2
            aria-hidden="true"
            className="h-2.5 w-2.5 animate-spin text-text-info"
          />
        </span>
      );
    }

    return (
      <span
        role="status"
        aria-label="Chat active"
        className={cn(
          "inline-flex h-3 w-3 shrink-0 items-center justify-center animate-in fade-in-0 duration-200 ease-out",
          className,
        )}
      >
        <Loader2
          aria-hidden="true"
          className="h-3 w-3 animate-spin text-text-info"
        />
      </span>
    );
  }

  if (runtimeStatus === "wait") {
    if (variant === "overlay") {
      return (
        <span
          role="status"
          aria-label="Chat waiting"
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2 w-2 shrink-0 rounded-full border border-background bg-background-warning transition-opacity duration-200 ease-out animate-in fade-in-0",
            className,
          )}
        />
      );
    }

    return (
      <span
        role="status"
        aria-label="Chat waiting"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full bg-background-warning transition-opacity duration-200 ease-out animate-in fade-in-0",
          className,
        )}
      />
    );
  }

  if (runtimeStatus === "dead") {
    if (variant === "overlay") {
      return (
        <span
          role="status"
          aria-label="Chat unavailable"
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2 w-2 shrink-0 rounded-full border border-background bg-danger transition-opacity duration-200 ease-out animate-in fade-in-0",
            className,
          )}
        />
      );
    }

    return (
      <span
        role="status"
        aria-label="Chat unavailable"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full bg-danger transition-opacity duration-200 ease-out animate-in fade-in-0",
          className,
        )}
      />
    );
  }

  if (!hasUnread) {
    if (!showIdle) {
      return null;
    }

    if (variant === "overlay") {
      return (
        <span
          role="status"
          aria-label="Chat idle"
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2 w-2 shrink-0 rounded-full border border-background bg-background-success transition-opacity duration-200 ease-out animate-in fade-in-0",
            className,
          )}
        />
      );
    }

    return (
      <span
        role="status"
        aria-label="Chat idle"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full bg-background-success transition-opacity duration-200 ease-out animate-in fade-in-0",
          className,
        )}
      />
    );
  }

  if (variant === "overlay") {
    return (
      <span
        role="status"
        aria-label="Unread messages"
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2 w-2 shrink-0 rounded-full border border-background bg-background-info transition-opacity duration-200 ease-out animate-in fade-in-0",
          className,
        )}
      />
    );
  }

  return (
    <span
      role="status"
      aria-label="Unread messages"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full bg-background-info transition-opacity duration-200 ease-out animate-in fade-in-0",
        className,
      )}
    />
  );
}
