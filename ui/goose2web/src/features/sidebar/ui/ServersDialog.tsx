import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IconArrowLeft,
  IconCheck,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  DialogClose,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  getActiveBackendServerName,
  getBackendServerAuth,
  getBackendServers,
  removeBackendServer,
  resolveBackendServerUrl,
  setActiveBackendServerName,
  setBackendServer,
  setBackendServerAuth,
  type BackendServerAuth,
} from "@/shared/api/backendConfig";
import { cn } from "@/shared/lib/cn";
import { checkBackendServerConnection } from "@/shared/api/backendConnection";
import {
  ServerStatusDot,
  type ServerConnectionStatus,
} from "./ServerStatusDot";

interface ServerItem {
  name: string;
  url: string;
  auth: BackendServerAuth | null;
}

interface ServersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ServersDialogView = "list" | "add";

function readServerItems(): ServerItem[] {
  const servers = getBackendServers();
  return Object.entries(servers)
    .map(([name, url]) => ({
      name,
      url,
      auth: getBackendServerAuth(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ServersDialog({ open, onOpenChange }: ServersDialogProps) {
  const { t } = useTranslation("sidebar");
  const [view, setView] = useState<ServersDialogView>("list");
  const [editingServerName, setEditingServerName] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [addServerName, setAddServerName] = useState("");
  const [addServerUrl, setAddServerUrl] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addToken, setAddToken] = useState("");
  const [activeServerName, setActiveServerNameState] = useState<string | null>(
    () => getActiveBackendServerName(),
  );
  const [servers, setServers] = useState<ServerItem[]>(() => readServerItems());
  const [serverStatuses, setServerStatuses] = useState<
    Record<string, ServerConnectionStatus>
  >({});
  const statusProbeRef = useRef(0);

  const filteredServers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return servers;
    }
    return servers.filter((server) => {
      const usernameValue = server.auth?.username ?? "";
      return (
        server.name.toLowerCase().includes(query) ||
        server.url.toLowerCase().includes(query) ||
        usernameValue.toLowerCase().includes(query)
      );
    });
  }, [search, servers]);

  const canSave = addServerUrl.trim().length > 0;

  function deriveServerName(url: string): string {
    try {
      const resolvedUrl = resolveBackendServerUrl(url) ?? `ws://${url}`;
      const parsed = new URL(resolvedUrl);
      return parsed.host || url;
    } catch {
      return url;
    }
  }

  const refreshStatuses = useCallback(async (items: ServerItem[]) => {
    const probeId = ++statusProbeRef.current;
    if (items.length === 0) {
      setServerStatuses({});
      return;
    }

    setServerStatuses((previous) => {
      const next: Record<string, ServerConnectionStatus> = {};
      for (const item of items) {
        next[item.name] = previous[item.name] ?? "checking";
      }
      return next;
    });

    const probed = await Promise.all(
      items.map(async (item) => ({
        name: item.name,
        status: (await checkBackendServerConnection(item.url, item.auth?.token))
          ? "connected"
          : "disconnected",
      })),
    );

    if (probeId !== statusProbeRef.current) {
      return;
    }

    setServerStatuses(
      Object.fromEntries(
        probed.map((item) => [item.name, item.status]),
      ) as Record<string, ServerConnectionStatus>,
    );
  }, []);

  const refreshServers = useCallback(() => {
    const nextServers = readServerItems();
    setServers(nextServers);
    setActiveServerNameState(getActiveBackendServerName());
    void refreshStatuses(nextServers);
  }, [refreshStatuses]);

  function handleSelectServer(name: string) {
    setActiveBackendServerName(name);
    setActiveServerNameState(name);
  }

  function handleRemoveServer(name: string) {
    removeBackendServer(name);
    refreshServers();
  }

  function handleAddServer() {
    const normalizedUrl = addServerUrl.trim();
    const normalizedName =
      addServerName.trim() || deriveServerName(normalizedUrl);
    if (!normalizedName || !normalizedUrl) {
      return;
    }

    setBackendServer(normalizedName, normalizedUrl);
    setBackendServerAuth(normalizedName, {
      username: addUsername.trim(),
      token: addToken.trim(),
    });
    setActiveBackendServerName(normalizedName);

    setAddServerName("");
    setAddServerUrl("");
    setAddUsername("");
    setAddToken("");
    refreshServers();
    setView("list");
  }

  function handleStartEditServer(server: ServerItem) {
    setEditingServerName(server.name);
    setAddServerName(server.name);
    setAddServerUrl(server.url);
    setAddUsername(server.auth?.username ?? "");
    setAddToken(server.auth?.token ?? "");
    setView("add");
  }

  function handleSaveServerEdit() {
    const normalizedUrl = addServerUrl.trim();
    const normalizedName = addServerName.trim();
    if (!editingServerName || !normalizedName || !normalizedUrl) {
      return;
    }

    if (editingServerName !== normalizedName) {
      removeBackendServer(editingServerName);
    }
    setBackendServer(normalizedName, normalizedUrl);
    setBackendServerAuth(normalizedName, {
      username: addUsername.trim(),
      token: addToken.trim(),
    });
    if (activeServerName === editingServerName) {
      setActiveBackendServerName(normalizedName);
    }

    setEditingServerName(null);
    setAddServerName("");
    setAddServerUrl("");
    setAddUsername("");
    setAddToken("");
    refreshServers();
    setView("list");
  }

  function handleBackToList() {
    setEditingServerName(null);
    setAddServerName("");
    setAddServerUrl("");
    setAddUsername("");
    setAddToken("");
    setView("list");
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setView("list");
    setEditingServerName(null);
    refreshServers();
    const intervalId = window.setInterval(() => {
      refreshServers();
    }, 5_000);
    return () => {
      statusProbeRef.current += 1;
      window.clearInterval(intervalId);
    };
  }, [open, refreshServers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-5xl gap-5 p-0 sm:max-w-5xl"
      >
        <DialogHeader className="px-6 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {view === "add" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleBackToList}
                  aria-label={t("servers.back")}
                  title={t("servers.back")}
                >
                  <IconArrowLeft className="size-4" />
                </Button>
              )}
              <DialogTitle>
                {view === "add"
                  ? editingServerName
                    ? t("servers.editServer")
                    : t("servers.addServer")
                  : t("servers.title")}
              </DialogTitle>
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("servers.close")}
                title={t("servers.close")}
              >
                <IconX className="size-4" />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          {view === "list" ? (
            <>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("servers.searchPlaceholder")}
                  className="h-11 pl-10"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-background-alt/50 p-2">
                {filteredServers.length === 0 ? (
                  <p className="px-3 py-6 text-sm text-muted-foreground">
                    {t("servers.empty")}
                  </p>
                ) : (
                  filteredServers.map((server) => {
                    const isActive = server.name === activeServerName;
                    const status = serverStatuses[server.name] ?? "checking";
                    return (
                      <div
                        key={server.name}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
                          isActive
                            ? "border-border bg-background"
                            : "border-transparent bg-background hover:border-border",
                        )}
                      >
                        <ServerStatusDot status={status} />
                        <button
                          type="button"
                          onClick={() => handleSelectServer(server.name)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium text-foreground">
                            {server.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {server.url}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {server.auth?.username || t("servers.noUsername")}
                          </p>
                        </button>
                        {isActive && (
                          <IconCheck className="size-4 shrink-0 text-foreground" />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleStartEditServer(server)}
                          aria-label={t("servers.edit")}
                          title={t("servers.edit")}
                        >
                          <IconEdit className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRemoveServer(server.name)}
                          aria-label={t("servers.remove")}
                          title={t("servers.remove")}
                        >
                          <IconTrash className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>

              <Button
                type="button"
                variant="outline-flat"
                className="w-fit"
                onClick={() => {
                  setEditingServerName(null);
                  setAddServerName("");
                  setAddServerUrl("");
                  setAddUsername("");
                  setAddToken("");
                  setView("add");
                }}
                leftIcon={<IconPlus />}
              >
                {t("servers.addServer")}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-4 rounded-xl border border-border bg-background-alt/50 p-5">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {t("servers.serverAddress")}
                  </p>
                  <Input
                    value={addServerUrl}
                    onChange={(event) => setAddServerUrl(event.target.value)}
                    placeholder={t("servers.urlPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {t("servers.serverNameOptional")}
                  </p>
                  <Input
                    value={addServerName}
                    onChange={(event) => setAddServerName(event.target.value)}
                    placeholder={t("servers.namePlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {t("servers.usernameOptional")}
                    </p>
                    <Input
                      value={addUsername}
                      onChange={(event) => setAddUsername(event.target.value)}
                      placeholder={t("servers.usernamePlaceholder")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {t("servers.tokenOptional")}
                    </p>
                    <Input
                      value={addToken}
                      onChange={(event) => setAddToken(event.target.value)}
                      type="password"
                      placeholder={t("servers.tokenPlaceholder")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
              <Button
                type="button"
                className="w-fit"
                onClick={
                  editingServerName ? handleSaveServerEdit : handleAddServer
                }
                disabled={!canSave}
              >
                {editingServerName
                  ? t("servers.saveServer")
                  : t("servers.addServer")}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
