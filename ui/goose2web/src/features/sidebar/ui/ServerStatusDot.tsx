import { cn } from "@/shared/lib/cn";

export type ServerConnectionStatus = "checking" | "connected" | "disconnected";

const SERVER_STATUS_STYLES: Record<ServerConnectionStatus, string> = {
  checking: "bg-border-strong",
  connected: "bg-border-success",
  disconnected: "bg-danger",
};

interface ServerStatusDotProps {
  status: ServerConnectionStatus;
  className?: string;
}

export function ServerStatusDot({ status, className }: ServerStatusDotProps) {
  return (
    <span
      aria-hidden
      data-testid="server-status-dot"
      className={cn(
        "size-2 shrink-0 rounded-full",
        SERVER_STATUS_STYLES[status],
        className,
      )}
    />
  );
}
