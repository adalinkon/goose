import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IconHistory,
  IconHome,
  IconLayoutSidebar,
  IconLayoutSidebarFilled,
  IconApps,
  IconArrowLeft,
  IconRobotFace,
  IconSearch,
  IconSettings,
  IconChefHat,
} from "@tabler/icons-react";
import { SkillIcon } from "@/features/skills/ui/SkillIcon";
import { getDisplaySessionTitle } from "@/features/chat/lib/sessionTitle";
import { GooseIcon } from "@/shared/ui/icons/GooseIcon";
import { cn } from "@/shared/lib/cn";
import type { AppView } from "@/app/AppShell";
import type { ProjectInfo } from "@/features/projects/api/projects";
import { useChatStore } from "@/features/chat/stores/chatStore";
import {
  selectSessionMessageCountById,
  selectSessionStateById,
} from "@/features/chat/stores/chatSelectors";
import { INITIAL_SESSION_CHAT_RUNTIME } from "@/shared/types/chat";
import {
  getVisibleSessionsByMessageCount,
  useChatSessionStore,
} from "@/features/chat/stores/chatSessionStore";
import { selectSessions } from "@/features/chat/stores/chatSessionSelectors";
import { isSessionRunning } from "@/features/chat/lib/sessionActivity";
import { useAgentStore } from "@/features/agents/stores/agentStore";
import { useProjectStore } from "@/features/projects/stores/projectStore";
import { selectProjects } from "@/features/projects/stores/projectSelectors";
import { Button } from "@/shared/ui/button";
import { useSessionSearch } from "@/features/sessions/hooks/useSessionSearch";
import { SidebarProjectsSection } from "./SidebarProjectsSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarSearchResults } from "./SidebarSearchResults";
import { ServersDialog } from "./ServersDialog";
import {
  getActiveBackendServerName,
  getActiveBackendServerAuth,
  getBackendServers,
} from "@/shared/api/backendConfig";
import { checkBackendServerConnection } from "@/shared/api/backendConnection";
import {
  ServerStatusDot,
  type ServerConnectionStatus,
} from "./ServerStatusDot";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  type SectionId,
} from "@/features/settings/ui/settingsSections";
import { SIDE_PANEL_DEFAULT_WIDTH } from "@/shared/constants/panels";

interface SidebarProps {
  collapsed: boolean;
  width?: number;
  isResizing?: boolean;
  onCollapse: () => void;
  onSettingsClick?: () => void;
  onSettingsBack?: () => void;
  onSettingsSectionChange?: (section: SectionId) => void;
  onNewChatInProject?: (projectId: string) => void;
  onNewChat?: () => void;
  onCreateProject?: () => void;
  onEditProject?: (projectId: string) => void;
  onArchiveProject?: (projectId: string) => void;
  onArchiveChat?: (sessionId: string) => void;
  onRenameChat?: (sessionId: string, nextTitle: string) => void;
  onMoveToProject?: (sessionId: string, projectId: string | null) => void;
  onReorderProject?: (fromId: string, toId: string) => void;
  onNavigate?: (view: AppView) => void;
  onSelectSession?: (sessionId: string) => void;
  onSelectSearchResult?: (
    sessionId: string,
    messageId?: string,
    query?: string,
  ) => void;
  activeView?: AppView;
  activeSettingsSection?: SectionId;
  activeSessionId?: string | null;
  className?: string;
  projects: ProjectInfo[];
}

const EXPANDED_PROJECTS_STORAGE_KEY = "goose:sidebar:expanded-projects";
const SECTION_VISIBILITY_STORAGE_KEY = "goose:sidebar:section-visibility";

type SidebarSection = "projects" | "recents";
type SidebarSectionVisibility = Record<SidebarSection, boolean>;

function getStoredSectionVisibility(): SidebarSectionVisibility {
  const defaults = { projects: true, recents: true };
  if (typeof window === "undefined") return defaults;
  try {
    const stored = window.localStorage.getItem(SECTION_VISIBILITY_STORAGE_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      projects:
        typeof parsed.projects === "boolean"
          ? parsed.projects
          : defaults.projects,
      recents:
        typeof parsed.recents === "boolean" ? parsed.recents : defaults.recents,
    };
  } catch {
    return defaults;
  }
}

export function Sidebar({
  collapsed,
  width = SIDE_PANEL_DEFAULT_WIDTH,
  isResizing = false,
  onCollapse,
  onSettingsClick,
  onSettingsBack,
  onSettingsSectionChange,
  onNewChatInProject,
  onNewChat,
  onCreateProject,
  onEditProject,
  onArchiveProject,
  onArchiveChat,
  onRenameChat,
  onMoveToProject,
  onReorderProject,
  onNavigate,
  onSelectSession,
  onSelectSearchResult,
  activeView,
  activeSettingsSection = DEFAULT_SETTINGS_SECTION,
  activeSessionId,
  className,
  projects,
}: SidebarProps) {
  const { t, i18n } = useTranslation(["sidebar", "common", "settings"]);
  const [expanded, setExpanded] = useState(!collapsed);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevCollapsed = useRef(collapsed);
  const activeServerProbeRef = useRef(0);
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const sessionMessageCountById = useChatStore(selectSessionMessageCountById);
  const [serversDialogOpen, setServersDialogOpen] = useState(false);
  const [activeServerName, setActiveServerName] = useState<string | null>(() =>
    getActiveBackendServerName(),
  );
  const [activeServerStatus, setActiveServerStatus] =
    useState<ServerConnectionStatus>("checking");
  const [sectionVisibility, setSectionVisibility] = useState(
    getStoredSectionVisibility,
  );
  const sessionStateById = useChatStore(selectSessionStateById);
  const sessions = useChatSessionStore(selectSessions);
  const getPersonaById = useAgentStore((s) => s.getPersonaById);
  const projectStoreProjects = useProjectStore(selectProjects);
  const visibleSessions = getVisibleSessionsByMessageCount(
    sessions,
    sessionMessageCountById,
  );
  const activeSessions = visibleSessions.filter(
    (session) => !session.archivedAt,
  );

  useEffect(() => {
    if (collapsed) {
      setExpanded(false);
    } else if (prevCollapsed.current && !collapsed) {
      const timer = setTimeout(() => setExpanded(true), 60);
      return () => clearTimeout(timer);
    } else {
      setExpanded(true);
    }
    prevCollapsed.current = collapsed;
  }, [collapsed]);

  const labelTransition = "transition-[opacity,width] duration-300 ease-out";
  const labelVisible = expanded && !collapsed;
  const isSettingsSurface = activeView === "settings";
  const defaultTitle = t("common:session.defaultTitle");
  const navItems: readonly {
    id: AppView;
    label: string;
    icon: typeof IconRobotFace;
  }[] = [
    { id: "agents", label: t("navigation.agents"), icon: IconRobotFace },
    { id: "recipes", label: t("navigation.recipes"), icon: IconChefHat },
    { id: "skills", label: t("navigation.skills"), icon: SkillIcon },
    {
      id: "extensions",
      label: t("navigation.extensions"),
      icon: IconApps,
    },
    {
      id: "session-history",
      label: t("navigation.sessionHistory"),
      icon: IconHistory,
    },
  ];

  const MAX_RECENTS = 20;
  const validProjectIds = new Set(projects.map((project) => project.id));

  const projectSessions = (() => {
    type SessionItem = {
      id: string;
      title: string;
      sessionId: string;
      projectId?: string;
      updatedAt: string;
      isRunning: boolean;
      hasUnread: boolean;
    };
    const byProject: Record<string, SessionItem[]> = {};
    const standalone: SessionItem[] = [];
    for (const session of visibleSessions) {
      if (session.archivedAt) continue;
      const runtime =
        sessionStateById[session.id] ?? INITIAL_SESSION_CHAT_RUNTIME;
      const item: SessionItem = {
        id: session.id,
        title: session.title,
        sessionId: session.id,
        projectId: session.projectId ?? undefined,
        updatedAt: session.updatedAt,
        isRunning: isSessionRunning(runtime.chatState),
        hasUnread: runtime.hasUnread,
      };
      if (session.projectId && validProjectIds.has(session.projectId)) {
        if (!byProject[session.projectId]) byProject[session.projectId] = [];
        byProject[session.projectId].push(item);
      } else {
        standalone.push(item);
      }
    }
    for (const chats of Object.values(byProject)) {
      chats.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }

    standalone.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const limitedStandalone = standalone.slice(0, MAX_RECENTS);
    return { byProject, standalone: limitedStandalone };
  })();

  const sidebarResolvers = {
    getPersonaName: (personaId: string) =>
      getPersonaById(personaId)?.displayName,
    getProjectName: (projectId: string) =>
      projectStoreProjects.find((p) => p.id === projectId)?.name,
  };
  const sidebarSearch = useSessionSearch({
    sessions: activeSessions,
    resolvers: sidebarResolvers,
    locale: i18n.resolvedLanguage,
    getDisplayTitle: (session) =>
      getDisplaySessionTitle(session.title, defaultTitle),
  });

  useEffect(() => {
    if (!activeSessionId) return;
    const activeSession = visibleSessions.find((s) => s.id === activeSessionId);
    const projectId = activeSession?.projectId;
    if (projectId) {
      setExpandedProjects((prev) => {
        if (prev[projectId]) return prev;
        return { ...prev, [projectId]: true };
      });
    }
  }, [activeSessionId, visibleSessions]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        EXPANDED_PROJECTS_STORAGE_KEY,
        JSON.stringify(expandedProjects),
      );
    } catch {
      // localStorage may be unavailable
    }
  }, [expandedProjects]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SECTION_VISIBILITY_STORAGE_KEY,
        JSON.stringify(sectionVisibility),
      );
    } catch {
      // localStorage may be unavailable
    }
  }, [sectionVisibility]);

  useEffect(() => {
    if (projects.length === 0) return;
    const validProjectIds = new Set(projects.map((project) => project.id));
    setExpandedProjects((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([projectId]) =>
          validProjectIds.has(projectId),
        ),
      );
      return Object.keys(next).length === Object.keys(prev).length
        ? prev
        : next;
    });
  }, [projects]);

  const refreshActiveServerStatus = useCallback(async () => {
    const probeId = ++activeServerProbeRef.current;
    const nextActiveServerName = getActiveBackendServerName();
    setActiveServerName(nextActiveServerName);
    if (!nextActiveServerName) {
      setActiveServerStatus("disconnected");
      return;
    }

    const servers = getBackendServers();
    const activeServerUrl = servers[nextActiveServerName];
    if (!activeServerUrl) {
      setActiveServerStatus("disconnected");
      return;
    }

    setActiveServerStatus("checking");
    const connected = await checkBackendServerConnection(
      activeServerUrl,
      getActiveBackendServerAuth()?.token,
    );
    if (probeId !== activeServerProbeRef.current) {
      return;
    }
    setActiveServerStatus(connected ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    void refreshActiveServerStatus();
    const intervalId = window.setInterval(() => {
      void refreshActiveServerStatus();
    }, 5_000);
    return () => {
      activeServerProbeRef.current += 1;
      window.clearInterval(intervalId);
    };
  }, [refreshActiveServerStatus]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleProject = (projectId: string) =>
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !prev[projectId] }));

  const toggleSection = (section: SidebarSection) =>
    setSectionVisibility((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));

  return (
    <div
      className={cn(
        "relative h-full",
        !isResizing && "transition-[width] duration-300 ease-in-out",
        className,
      )}
      style={{ width: collapsed ? 54 : width }}
    >
      <div className="flex h-full flex-col overflow-hidden border-r border-border bg-background">
        <div
          className={cn(
            "flex-shrink-0 pt-2",
            collapsed ? "px-1.5 pb-1.5" : "px-3 pb-1",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              collapsed ? "justify-center" : "justify-between",
            )}
          >
            <button
              type="button"
              onClick={() => setServersDialogOpen(true)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                "hover:bg-background-alt",
                collapsed ? "w-8 justify-center px-0" : "flex-1",
              )}
              title={activeServerName ?? t("servers.none")}
              aria-label={t("servers.open")}
            >
              <GooseIcon className="text-foreground" />
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {activeServerName ?? t("servers.none")}
                </span>
              )}
              <ServerStatusDot status={activeServerStatus} />
            </button>
            {!collapsed && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onCollapse}
                className="text-foreground hover:text-foreground"
                aria-label={t("actions.collapse")}
                title={t("actions.collapse")}
              >
                <IconLayoutSidebarFilled className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
              isSettingsSurface
                ? "pointer-events-none -translate-x-full opacity-0"
                : "translate-x-0 opacity-100",
            )}
            inert={isSettingsSurface ? true : undefined}
            aria-hidden={isSettingsSurface}
          >
            <nav
              className={cn(
                "relative h-full overflow-y-auto overflow-x-hidden px-1.5 py-1 pt-1 scrollbar-none",
                collapsed ? "pb-16" : "pb-[72px]",
              )}
              aria-label={t("navigation.main")}
            >
              <div className="relative z-10 space-y-0.5">
                {collapsed && (
                  <button
                    type="button"
                    onClick={onCollapse}
                    title={t("actions.expand")}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-foreground transition-colors duration-200 hover:text-foreground"
                    aria-label={t("actions.expand")}
                  >
                    <IconLayoutSidebar className="size-4 flex-shrink-0" />
                    <span className="sr-only">{t("actions.expand")}</span>
                  </button>
                )}

                <div
                  className={cn(
                    "mb-3 flex items-center w-full rounded-md transition-all duration-300 ease-out",
                    collapsed
                      ? "justify-center p-3 text-foreground"
                      : "gap-2 border border-border px-2.5 py-1.5 text-xs text-foreground hover:text-foreground hover:bg-transparent",
                  )}
                >
                  <IconSearch className="size-3.5 flex-shrink-0 text-placeholder" />
                  {!collapsed && (
                    <input
                      ref={searchInputRef}
                      type="text"
                      enterKeyHint="search"
                      value={sidebarSearch.query}
                      onChange={(e) => sidebarSearch.setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void sidebarSearch.search();
                        }
                      }}
                      placeholder={t("search.placeholder")}
                      className={cn(
                        "focus-override appearance-none bg-transparent border-none text-xs flex-1 min-w-0 placeholder:text-placeholder outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                        labelTransition,
                        labelVisible
                          ? "opacity-100 w-auto"
                          : "opacity-0 w-0 overflow-hidden",
                      )}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>

                <SidebarNavItem
                  testId="nav-home"
                  icon={IconHome}
                  label={t("navigation.home")}
                  collapsed={collapsed}
                  labelTransition={labelTransition}
                  labelVisible={labelVisible}
                  isActive={activeView === "home"}
                  onClick={() => onNavigate?.("home")}
                />

                {navItems.map((item, index) => {
                  const isActive = activeView === item.id;
                  return (
                    <SidebarNavItem
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      collapsed={collapsed}
                      labelTransition={labelTransition}
                      labelVisible={labelVisible}
                      isActive={isActive}
                      onClick={() => onNavigate?.(item.id)}
                      itemTransitionDelay={
                        !collapsed && expanded ? `${index * 30}ms` : "0ms"
                      }
                      labelTransitionDelay={
                        labelVisible ? `${index * 30 + 60}ms` : "0ms"
                      }
                    />
                  );
                })}
              </div>

              {!collapsed &&
                (sidebarSearch.submittedQuery ? (
                  <div className="relative z-10 space-y-2">
                    {sidebarSearch.error && (
                      <p className="px-1 text-xs text-danger">
                        {t("search.error")}
                      </p>
                    )}

                    {sidebarSearch.isSearching &&
                      sidebarSearch.results.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                          {t("search.searching")}
                        </div>
                      )}

                    {(!sidebarSearch.isSearching ||
                      sidebarSearch.results.length > 0) && (
                      <SidebarSearchResults
                        results={sidebarSearch.results}
                        activeSessionId={activeSessionId}
                        onSelectResult={(sessionId, messageId) => {
                          if (messageId) {
                            onSelectSearchResult?.(
                              sessionId,
                              messageId,
                              sidebarSearch.submittedQuery,
                            );
                            return;
                          }
                          onSelectSession?.(sessionId);
                        }}
                        getPersonaName={sidebarResolvers.getPersonaName}
                        getProjectName={sidebarResolvers.getProjectName}
                      />
                    )}
                  </div>
                ) : (
                  <SidebarProjectsSection
                    projects={projects}
                    projectSessions={projectSessions}
                    expandedProjects={expandedProjects}
                    toggleProject={toggleProject}
                    collapsed={collapsed}
                    labelTransition={labelTransition}
                    labelVisible={labelVisible}
                    activeSessionId={activeSessionId}
                    onNavigate={onNavigate}
                    onSelectSession={onSelectSession}
                    onNewChatInProject={onNewChatInProject}
                    onNewChat={onNewChat}
                    onCreateProject={onCreateProject}
                    onEditProject={onEditProject}
                    onArchiveProject={onArchiveProject}
                    onArchiveChat={onArchiveChat}
                    onRenameChat={onRenameChat}
                    onMoveToProject={onMoveToProject}
                    onReorderProject={onReorderProject}
                    projectsSectionOpen={sectionVisibility.projects}
                    recentsSectionOpen={sectionVisibility.recents}
                    onToggleProjectsSection={() => toggleSection("projects")}
                    onToggleRecentsSection={() => toggleSection("recents")}
                  />
                ))}
            </nav>

            <div
              className={cn(
                "absolute inset-x-0 bottom-0 z-20 bg-background",
                "px-1.5 py-1.5",
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size={collapsed ? "icon-sm" : "default"}
                onClick={onSettingsClick}
                className={cn(
                  "h-10 w-full rounded-md bg-transparent text-muted-foreground/85 hover:bg-transparent hover:text-foreground active:bg-transparent",
                  collapsed
                    ? "justify-center p-3"
                    : "justify-start gap-2.5 px-3 py-2.5",
                )}
                title={t("settings:title")}
                aria-label={t("settings:title")}
              >
                <IconSettings className="size-4 flex-shrink-0" />
                {!collapsed && (
                  <span
                    className={cn(
                      "whitespace-nowrap text-sm",
                      labelTransition,
                      labelVisible
                        ? "opacity-100 w-auto"
                        : "opacity-0 w-0 overflow-hidden",
                    )}
                  >
                    {t("settings:title")}
                  </span>
                )}
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
              isSettingsSurface
                ? "translate-x-0 opacity-100"
                : "pointer-events-none translate-x-full opacity-0",
            )}
            inert={!isSettingsSurface ? true : undefined}
            aria-hidden={!isSettingsSurface}
          >
            <nav
              className="h-full overflow-y-auto overflow-x-hidden px-1.5 py-1 scrollbar-none"
              aria-label={t("settings:navigationLabel")}
            >
              <div className="space-y-0.5">
                {collapsed && (
                  <button
                    type="button"
                    onClick={onCollapse}
                    title={t("actions.expand")}
                    className="flex w-full items-center justify-center rounded-md px-3 py-1.5 text-sm text-foreground transition-colors duration-200 hover:text-foreground"
                    aria-label={t("actions.expand")}
                  >
                    <IconLayoutSidebar className="size-4 flex-shrink-0" />
                    <span className="sr-only">{t("actions.expand")}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onSettingsBack}
                  title={
                    collapsed ? t("actions.backToMainNavigation") : undefined
                  }
                  aria-label={t("actions.backToMainNavigation")}
                  className={cn(
                    "mb-3 flex w-full items-center rounded-md text-sm text-foreground transition-colors duration-200 hover:bg-background-alt hover:text-foreground",
                    collapsed
                      ? "justify-center px-3 py-1.5"
                      : "gap-2.5 px-3 py-1.5",
                  )}
                >
                  <IconArrowLeft className="size-4 flex-shrink-0" />
                  {!collapsed && (
                    <span
                      className={cn(
                        "whitespace-nowrap",
                        labelTransition,
                        labelVisible
                          ? "opacity-100 w-auto"
                          : "opacity-0 w-0 overflow-hidden",
                      )}
                    >
                      {t("actions.backToMainNavigation")}
                    </span>
                  )}
                </button>

                {SETTINGS_SECTIONS.map((item, index) => (
                  <SidebarNavItem
                    key={item.id}
                    icon={item.icon}
                    label={t(`settings:${item.labelKey}`)}
                    collapsed={collapsed}
                    labelTransition={labelTransition}
                    labelVisible={labelVisible}
                    isActive={activeSettingsSection === item.id}
                    onClick={() => onSettingsSectionChange?.(item.id)}
                    itemTransitionDelay={
                      !collapsed && expanded ? `${index * 30}ms` : "0ms"
                    }
                    labelTransitionDelay={
                      labelVisible ? `${index * 30 + 60}ms` : "0ms"
                    }
                  />
                ))}
              </div>
            </nav>
          </div>
        </div>
      </div>
      <ServersDialog
        open={serversDialogOpen}
        onOpenChange={(open) => {
          setServersDialogOpen(open);
          void refreshActiveServerStatus();
        }}
      />
    </div>
  );
}
