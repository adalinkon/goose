import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sidebar } from "@/features/sidebar/ui/Sidebar";
import { CreateProjectDialog } from "@/features/projects/ui/CreateProjectDialog";
import { archiveProject } from "@/features/projects/api/projects";
import type { ProjectInfo } from "@/features/projects/api/projects";
import {
  DEFAULT_SETTINGS_SECTION,
  normalizeSettingsSection,
  type SectionId,
} from "@/features/settings/ui/settingsSections";
import { OPEN_SETTINGS_EVENT } from "@/features/settings/lib/settingsEvents";
import { useChatStore } from "@/features/chat/stores/chatStore";
import { selectMessagesBySession } from "@/features/chat/stores/chatSelectors";
import { sessionRuntimeCoordinator } from "@/features/chat/runtime/sessionRuntimeCoordinator";
import {
  type ChatSession,
  useChatSessionStore,
} from "@/features/chat/stores/chatSessionStore";
import {
  selectActiveSessionId,
  selectHasHydratedSessions,
  selectSessions,
  selectSessionsLoading,
} from "@/features/chat/stores/chatSessionSelectors";
import { useAgentStore } from "@/features/agents/stores/agentStore";
import { selectSelectedProvider } from "@/features/agents/stores/agentSelectors";
import { useProjectStore } from "@/features/projects/stores/projectStore";
import { selectProjects } from "@/features/projects/stores/projectSelectors";
import { findExistingDraft } from "@/features/chat/lib/newChat";
import { DEFAULT_CHAT_TITLE } from "@/features/chat/lib/sessionTitle";
import { useAppStartup } from "./hooks/useAppStartup";
import { useHomeSessionStateSync } from "./hooks/useHomeSessionStateSync";
import { loadStoredHomeSessionId } from "./lib/homeSessionStorage";
import { resolveSupportedSessionModelPreference } from "./lib/resolveSupportedSessionModelPreference";
import { useCreatePersonaNavigation } from "./hooks/useCreatePersonaNavigation";
import { AppShellContent } from "./ui/AppShellContent";
import { applyLatestSessionConfig } from "@/features/chat/lib/sessionConfigRequests";
import { updateSessionTitle } from "@/features/chat/stores/chatSessionOperations";
import { resolveSessionCwd } from "@/features/projects/lib/sessionCwdSelection";
import { perfLog } from "@/shared/lib/perfLog";
import { useProviderInventoryStore } from "@/features/providers/stores/providerInventoryStore";
import type { SkillInfo } from "@/features/skills/api/skills";
import { toChatSkillDraft } from "@/features/skills/lib/skillChatPrompt";
import { Spinner } from "@/shared/ui/spinner";
import { SIDE_PANEL_DEFAULT_WIDTH } from "@/shared/constants/panels";

export type AppView =
  | "home"
  | "chat"
  | "skills"
  | "recipes"
  | "extensions"
  | "agents"
  | "projects"
  | "session-history"
  | "settings";

const SIDEBAR_OUTER_GUTTER_WIDTH = 0;
const SIDEBAR_RESIZE_HANDLE_WIDTH = 12;
const SIDEBAR_DEFAULT_WIDTH = SIDE_PANEL_DEFAULT_WIDTH;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 380;
const SIDEBAR_SNAP_COLLAPSE_THRESHOLD = 100;
const SIDEBAR_COLLAPSED_WIDTH = 48;

const VIEW_PATHS: Partial<Record<AppView, string>> = {
  home: "/",
  agents: "/agents",
  recipes: "/recipes",
  skills: "/skills",
  extensions: "/extensions",
  projects: "/projects",
  "session-history": "/sessions",
};

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function getRouteSessionId(pathname: string): string | null {
  const match = normalizePathname(pathname).match(/^\/chat\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getActiveViewFromPathname(pathname: string): AppView {
  const normalized = normalizePathname(pathname);
  if (normalized === "/settings") return "settings";
  if (getRouteSessionId(normalized)) return "chat";
  const match = Object.entries(VIEW_PATHS).find(
    ([, path]) => path === normalized,
  );
  return (match?.[0] as AppView | undefined) ?? "home";
}

function isKnownPathname(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return (
    normalized === "/settings" ||
    getRouteSessionId(normalized) !== null ||
    Object.values(VIEW_PATHS).includes(normalized)
  );
}

function getSettingsPath(section: SectionId): string {
  return `/settings?section=${encodeURIComponent(section)}`;
}

function getChatPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

function getSettingsSection(search: string): SectionId {
  const section = new URLSearchParams(search).get("section");
  return section ? normalizeSettingsSection(section) : DEFAULT_SETTINGS_SECTION;
}

function getViewPath(view: AppView): string {
  if (view === "settings") return getSettingsPath(DEFAULT_SETTINGS_SECTION);
  return VIEW_PATHS[view] ?? "/";
}

export function AppShell({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation("chat");
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = getActiveViewFromPathname(location.pathname);
  const activeSettingsSection =
    activeView === "settings"
      ? getSettingsSection(location.search)
      : DEFAULT_SETTINGS_SECTION;
  const routeSessionId = getRouteSessionId(location.pathname);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectInitialWorkingDir, setCreateProjectInitialWorkingDir] =
    useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(
    null,
  );
  const [homeSessionId, setHomeSessionId] = useState<string | null>(() =>
    loadStoredHomeSessionId(),
  );

  const messagesBySession = useChatStore(selectMessagesBySession);
  const setChatActiveSession = useChatStore((s) => s.setActiveSession);
  const cleanupChatSession = useChatStore((s) => s.cleanupSession);
  const sessions = useChatSessionStore(selectSessions);
  const activeSessionId = useChatSessionStore(selectActiveSessionId);
  const hasHydratedSessions = useChatSessionStore(selectHasHydratedSessions);
  const sessionsLoading = useChatSessionStore(selectSessionsLoading);
  const createSession = useChatSessionStore((s) => s.createSession);
  const patchSession = useChatSessionStore((s) => s.patchSession);
  const setActiveSession = useChatSessionStore((s) => s.setActiveSession);
  const archiveSession = useChatSessionStore((s) => s.archiveSession);
  const selectedProvider = useAgentStore(selectSelectedProvider);
  const projects = useProjectStore(selectProjects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const reorderProjects = useProjectStore((s) => s.reorderProjects);
  const providerInventoryEntries = useProviderInventoryStore((s) => s.entries);
  const startup = useAppStartup();
  const pendingProjectCreatedRef = useRef<((projectId: string) => void) | null>(
    null,
  );
  const lastNonSettingsPathRef = useRef("/");
  const lastSyncedRouteSessionIdRef = useRef<string | null>(null);
  const homeSessionRequestRef = useRef<Promise<ChatSession | null> | null>(
    null,
  );
  const loadSessionMessages = useCallback((sessionId: string) => {
    return sessionRuntimeCoordinator.ensureSessionAttached(sessionId);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (activeView === "chat" && activeSessionId) {
      sessionRuntimeCoordinator.activateSession(activeSessionId, {
        activeView,
      });
      useChatStore.getState().markSessionRead(activeSessionId);
      void sessionRuntimeCoordinator.ensureSessionAttached(activeSessionId);
      return;
    }
    sessionRuntimeCoordinator.setActiveView(activeView);
  }, [activeSessionId, activeView]);

  useEffect(() => {
    if (!isKnownPathname(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (activeView !== "settings") {
      lastNonSettingsPathRef.current = `${location.pathname}${location.search}`;
    }
  }, [activeView, location.pathname, location.search]);

  const visibleActiveSessionId =
    activeView === "chat" ? (routeSessionId ?? activeSessionId) : null;
  const activeSession = visibleActiveSessionId
    ? sessions.find((session) => session.id === visibleActiveSessionId)
    : undefined;
  const homeSession = homeSessionId
    ? sessions.find((session) => session.id === homeSessionId)
    : undefined;

  useHomeSessionStateSync({
    homeSessionId,
    homeSession,
    messagesBySession,
    hasHydratedSessions,
    isLoading: sessionsLoading,
    setHomeSessionId,
  });

  const ensureHomeSession = useCallback(async () => {
    if (!hasHydratedSessions || sessionsLoading) {
      return null;
    }

    if (homeSessionRequestRef.current) {
      return homeSessionRequestRef.current;
    }

    const request = (async () => {
      const currentProvider = () =>
        useAgentStore.getState().selectedProvider ?? "goose";

      // Resolve the provider to use after an async gap. If the user changed
      // their selection while we were awaiting (liveProvider differs from what
      // it was before the await), prefer the live value; otherwise use the
      // model-preference resolution result.
      const resolveProviderAfterAwait = (
        providerAtStart: string,
        sessionModelPreference: { providerId: string },
      ): string => {
        const liveProvider = currentProvider();
        return liveProvider !== providerAtStart
          ? liveProvider
          : sessionModelPreference.providerId;
      };

      if (
        homeSession &&
        !homeSession.archivedAt &&
        homeSession.messageCount === 0
      ) {
        const providerAtStart = currentProvider();
        const sessionModelPreference =
          await resolveSupportedSessionModelPreference(
            providerAtStart,
            providerInventoryEntries,
          );
        const project = homeSession.projectId
          ? (projects.find(
              (candidate) => candidate.id === homeSession.projectId,
            ) ?? null)
          : null;
        const workingDir = await resolveSessionCwd(project);
        const resolvedProviderId = resolveProviderAfterAwait(
          providerAtStart,
          sessionModelPreference,
        );
        const modelIdToApply =
          resolvedProviderId === sessionModelPreference.providerId
            ? sessionModelPreference.modelId
            : undefined;
        const result = await applyLatestSessionConfig({
          sessionId: homeSession.id,
          providerId: resolvedProviderId,
          workingDir,
          modelId: modelIdToApply,
        });
        if (!result.applied) {
          return homeSession;
        }

        const shouldClearHomeModel =
          resolvedProviderId !== homeSession.providerId || !modelIdToApply;
        patchSession(homeSession.id, {
          providerId: resolvedProviderId,
          modelId:
            modelIdToApply ??
            (shouldClearHomeModel ? undefined : homeSession.modelId),
          modelName:
            modelIdToApply != null
              ? sessionModelPreference.modelName
              : shouldClearHomeModel
                ? undefined
                : homeSession.modelName,
        });
        return (
          useChatSessionStore.getState().getSession(homeSession.id) ??
          homeSession
        );
      }

      const providerAtStart = currentProvider();
      const workingDir = await resolveSessionCwd(null);
      const sessionModelPreference =
        await resolveSupportedSessionModelPreference(
          providerAtStart,
          providerInventoryEntries,
        );
      const resolvedProviderId = resolveProviderAfterAwait(
        providerAtStart,
        sessionModelPreference,
      );
      const session = await createSession({
        title: DEFAULT_CHAT_TITLE,
        providerId: resolvedProviderId,
        workingDir,
        modelId:
          resolvedProviderId === sessionModelPreference.providerId
            ? sessionModelPreference.modelId
            : undefined,
        modelName:
          resolvedProviderId === sessionModelPreference.providerId
            ? sessionModelPreference.modelName
            : undefined,
      });
      setHomeSessionId(session.id);
      return session;
    })();

    homeSessionRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (homeSessionRequestRef.current === request) {
        homeSessionRequestRef.current = null;
      }
    }
  }, [
    createSession,
    hasHydratedSessions,
    homeSession,
    providerInventoryEntries,
    projects,
    sessionsLoading,
    patchSession,
  ]);

  useEffect(() => {
    if (activeView !== "home" || !startup.backendConnected) {
      return;
    }
    void ensureHomeSession().catch((error) => {
      console.error("Failed to ensure Home session:", error);
    });
  }, [activeView, ensureHomeSession, startup.backendConnected]);

  const createNewTab = useCallback(
    async (title = DEFAULT_CHAT_TITLE, project?: ProjectInfo) => {
      const tStart = performance.now();
      perfLog(
        `[perf:newtab] createNewTab start (project=${project?.id ?? "none"})`,
      );
      const providerId =
        project?.preferredProvider ?? selectedProvider ?? "goose";
      const sessionModelPreference =
        await resolveSupportedSessionModelPreference(
          providerId,
          providerInventoryEntries,
          project?.preferredModel ?? undefined,
        );
      const sessionState = useChatSessionStore.getState();
      const chatState = useChatStore.getState();
      const existingDraft = findExistingDraft({
        sessions: sessionState.sessions,
        activeSessionId: sessionState.activeSessionId,
        draftsBySession: chatState.draftsBySession,
        messagesBySession: chatState.messagesBySession,
        request: {
          title,
          projectId: project?.id,
        },
      });

      if (existingDraft) {
        setActiveSession(existingDraft.id);
        setChatActiveSession(existingDraft.id);
        lastSyncedRouteSessionIdRef.current = existingDraft.id;
        navigate(getChatPath(existingDraft.id));
        perfLog(
          `[perf:newtab] ${existingDraft.id.slice(0, 8)} reused draft in ${(performance.now() - tStart).toFixed(1)}ms`,
        );
        return existingDraft;
      }

      const workingDir = await resolveSessionCwd(project);
      const session = await createSession({
        title,
        projectId: project?.id,
        providerId: sessionModelPreference.providerId,
        workingDir,
        modelId: sessionModelPreference.modelId,
        modelName: sessionModelPreference.modelName,
      });
      setActiveSession(session.id);
      setChatActiveSession(session.id);
      lastSyncedRouteSessionIdRef.current = session.id;
      navigate(getChatPath(session.id));
      perfLog(
        `[perf:newtab] ${session.id.slice(0, 8)} created session in ${(performance.now() - tStart).toFixed(1)}ms`,
      );
      return session;
    },
    [
      selectedProvider,
      createSession,
      providerInventoryEntries,
      setActiveSession,
      setChatActiveSession,
      navigate,
    ],
  );

  const handleStartChatFromProject = useCallback(
    (project: ProjectInfo) => {
      void createNewTab(DEFAULT_CHAT_TITLE, project);
    },
    [createNewTab],
  );

  const handleStartChatWithSkill = useCallback(
    (skill: SkillInfo, projectId?: string | null) => {
      const project = projectId
        ? projects.find((candidate) => candidate.id === projectId)
        : undefined;

      void createNewTab(DEFAULT_CHAT_TITLE, project)
        .then((session) => {
          useChatStore
            .getState()
            .setSkillDrafts(session.id, [toChatSkillDraft(skill)]);
        })
        .catch((error) => {
          console.error("Failed to start chat with skill:", error);
        });
    },
    [createNewTab, projects],
  );

  const handleNewChatInProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        void createNewTab(DEFAULT_CHAT_TITLE, project);
      }
    },
    [createNewTab, projects],
  );

  const handleArchiveProject = useCallback(
    async (projectId: string) => {
      try {
        await archiveProject(projectId);
        fetchProjects();
      } catch {
        // best-effort
      }
    },
    [fetchProjects],
  );

  const clearActiveSession = useCallback(
    (sessionId: string) => {
      cleanupChatSession(sessionId);
      setActiveSession(null);
      lastSyncedRouteSessionIdRef.current = null;
      navigate("/");
    },
    [cleanupChatSession, setActiveSession, navigate],
  );
  const openSettings = useCallback(
    (section: SectionId = DEFAULT_SETTINGS_SECTION) => {
      if (activeView !== "settings") {
        lastNonSettingsPathRef.current = `${location.pathname}${location.search}`;
      }
      navigate(getSettingsPath(section), {
        replace: activeView === "settings",
      });
      if (sidebarCollapsed) {
        setSidebarCollapsed(false);
      }
    },
    [
      activeView,
      location.pathname,
      location.search,
      navigate,
      sidebarCollapsed,
    ],
  );

  const leaveSettings = useCallback(() => {
    navigate(lastNonSettingsPathRef.current || "/", { replace: true });
  }, [navigate]);

  const selectSettingsSection = useCallback(
    (section: SectionId) => {
      navigate(getSettingsPath(section), { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    const handleOpenSettingsEvent = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail
        ?.section;
      if (section) {
        openSettings(normalizeSettingsSection(section));
        return;
      }

      openSettings();
    };

    window.addEventListener(
      OPEN_SETTINGS_EVENT,
      handleOpenSettingsEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        OPEN_SETTINGS_EVENT,
        handleOpenSettingsEvent as EventListener,
      );
    };
  }, [openSettings]);

  const handleArchiveChat = useCallback(
    async (sessionId: string) => {
      const { activeSessionId: currentActiveSessionId } =
        useChatSessionStore.getState();
      const wasActiveSession = currentActiveSessionId === sessionId;

      try {
        await archiveSession(sessionId);
        cleanupChatSession(sessionId);

        if (!wasActiveSession) {
          return;
        }

        setActiveSession(null);
        lastSyncedRouteSessionIdRef.current = null;
        navigate("/");
      } catch {
        // best-effort
      }
    },
    [archiveSession, cleanupChatSession, setActiveSession, navigate],
  );

  const handleEditProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        setEditingProject(project);
        setCreateProjectOpen(true);
      }
    },
    [projects],
  );

  const handleMoveToProject = useCallback(
    (sessionId: string, projectId: string | null) => {
      useChatSessionStore.getState().patchSession(sessionId, { projectId });

      const session = useChatSessionStore.getState().getSession(sessionId);
      if (!session) {
        return;
      }

      void (async () => {
        const nextProject =
          projectId == null
            ? null
            : (useProjectStore
                .getState()
                .projects.find((project) => project.id === projectId) ?? null);
        const workingDir = await resolveSessionCwd(nextProject);
        if (!workingDir) {
          return;
        }
        await applyLatestSessionConfig({
          sessionId,
          providerId: session.providerId ?? selectedProvider ?? "goose",
          workingDir,
          modelId: session.modelId,
        });
      })().catch((error) => {
        console.error(
          "Failed to update ACP session project working directory:",
          error,
        );
      });
    },
    [selectedProvider],
  );

  const handleRenameChat = useCallback(
    (sessionId: string, nextTitle: string) => {
      void updateSessionTitle(sessionId, nextTitle).catch((error) => {
        console.error("Failed to rename session:", error);
        toast.error(t("notifications.renameError"));
      });
    },
    [t],
  );

  const openCreateProjectDialog = useCallback(
    (options?: {
      initialWorkingDir?: string | null;
      onCreated?: (projectId: string) => void;
    }) => {
      setEditingProject(null);
      setCreateProjectInitialWorkingDir(options?.initialWorkingDir ?? null);
      pendingProjectCreatedRef.current = options?.onCreated ?? null;
      setCreateProjectOpen(true);
    },
    [],
  );

  const activateHomeSession = useCallback(
    (sessionId: string) => {
      if (homeSessionId === sessionId) {
        setHomeSessionId(null);
      }
      setActiveSession(sessionId);
      setChatActiveSession(sessionId);
      sessionRuntimeCoordinator.activateSession(sessionId, {
        activeView: "chat",
      });
      lastSyncedRouteSessionIdRef.current = sessionId;
      navigate(getChatPath(sessionId));
      useChatStore.getState().markSessionRead(sessionId);
    },
    [homeSessionId, setActiveSession, setChatActiveSession, navigate],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      setActiveSession(id);
      setChatActiveSession(id);
      sessionRuntimeCoordinator.activateSession(id, { activeView: "chat" });
      lastSyncedRouteSessionIdRef.current = id;
      navigate(getChatPath(id));
      useChatStore.getState().markSessionRead(id);
      loadSessionMessages(id);
    },
    [setActiveSession, setChatActiveSession, navigate, loadSessionMessages],
  );

  const handleSelectSearchResult = useCallback(
    (sessionId: string, messageId?: string, query?: string) => {
      if (messageId) {
        useChatStore
          .getState()
          .setScrollTargetMessage(sessionId, messageId, query);
      }
      handleSelectSession(sessionId);
    },
    [handleSelectSession],
  );

  useEffect(() => {
    if (activeView !== "chat" || !routeSessionId) {
      return;
    }
    if (!hasHydratedSessions || sessionsLoading) {
      return;
    }

    const routeSession = sessions.find(
      (session) => session.id === routeSessionId,
    );
    if (!routeSession) {
      setActiveSession(null);
      navigate("/", { replace: true });
      return;
    }

    if (activeSessionId !== routeSessionId) {
      setActiveSession(routeSessionId);
    }
    setChatActiveSession(routeSessionId);
    useChatStore.getState().markSessionRead(routeSessionId);

    if (lastSyncedRouteSessionIdRef.current !== routeSessionId) {
      lastSyncedRouteSessionIdRef.current = routeSessionId;
      loadSessionMessages(routeSessionId);
    }
  }, [
    activeView,
    activeSessionId,
    hasHydratedSessions,
    loadSessionMessages,
    navigate,
    routeSessionId,
    sessions,
    sessionsLoading,
    setActiveSession,
    setChatActiveSession,
  ]);

  useEffect(() => {
    if (activeView !== "chat" && activeView !== "settings" && activeSessionId) {
      setActiveSession(null);
    }
  }, [activeSessionId, activeView, setActiveSession]);

  const handleNavigate = useCallback(
    (view: AppView) => {
      if (view === "settings") {
        openSettings();
        return;
      }
      if (view !== "chat") {
        setActiveSession(null);
      }
      navigate(getViewPath(view));
    },
    [openSettings, setActiveSession, navigate],
  );

  const handleCreatePersona = useCreatePersonaNavigation(() =>
    handleNavigate("agents"),
  );

  const collapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const expandSidebar = useCallback(() => {
    setSidebarCollapsed(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (sidebarCollapsed) {
      expandSidebar();
      return;
    }

    collapseSidebar();
  }, [collapseSidebar, expandSidebar, sidebarCollapsed]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = sidebarCollapsed
        ? SIDEBAR_COLLAPSED_WIDTH
        : sidebarWidth;
      let shouldCollapse = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = startWidth + delta;

        if (newWidth < SIDEBAR_SNAP_COLLAPSE_THRESHOLD) {
          shouldCollapse = true;
          setSidebarWidth(SIDEBAR_MIN_WIDTH);
        } else {
          shouldCollapse = false;
          setSidebarCollapsed(false);
          setSidebarWidth(
            Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, newWidth)),
          );
        }
      };

      const cleanup = () => {
        setIsResizing(false);
        if (shouldCollapse) setSidebarCollapsed(true);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", cleanup);
        window.removeEventListener("blur", cleanup);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", cleanup);
      window.addEventListener("blur", cleanup);
    },
    [sidebarCollapsed, sidebarWidth],
  );

  const handleResizeDoubleClick = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    setSidebarCollapsed(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+, for settings
      if (e.key === "," && e.metaKey) {
        e.preventDefault();
        if (activeView === "settings") {
          leaveSettings();
          return;
        }
        openSettings();
      }
      // Cmd+B for sidebar toggle
      if (e.key === "b" && e.metaKey) {
        e.preventDefault();
        toggleSidebar();
      }
      // Cmd+W returns to home instead of closing the window
      if (e.key === "w" && e.metaKey) {
        e.preventDefault();
        if (activeView === "settings") {
          leaveSettings();
          return;
        }
        const { activeSessionId } = useChatSessionStore.getState();
        if (activeSessionId) {
          clearActiveSession(activeSessionId);
        }
      }
      // Cmd+N opens new conversation screen
      if (e.key === "n" && e.metaKey) {
        e.preventDefault();
        setActiveSession(null);
        navigate("/");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeView,
    clearActiveSession,
    leaveSettings,
    navigate,
    openSettings,
    setActiveSession,
    toggleSidebar,
  ]);

  if (!startup.ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <Spinner className="size-5 text-brand" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className="flex-shrink-0 h-full"
          style={{
            width: sidebarCollapsed
              ? SIDEBAR_COLLAPSED_WIDTH + SIDEBAR_OUTER_GUTTER_WIDTH
              : sidebarWidth + SIDEBAR_OUTER_GUTTER_WIDTH,
            transition: isResizing ? "none" : "width 200ms ease-out",
          }}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            isResizing={isResizing}
            onCollapse={toggleSidebar}
            onSettingsClick={() => openSettings()}
            onSettingsBack={leaveSettings}
            onSettingsSectionChange={selectSettingsSection}
            onNavigate={handleNavigate}
            onNewChatInProject={handleNewChatInProject}
            onNewChat={() => {
              setActiveSession(null);
              navigate("/");
            }}
            onCreateProject={() => openCreateProjectDialog()}
            onEditProject={handleEditProject}
            onArchiveProject={handleArchiveProject}
            onArchiveChat={handleArchiveChat}
            onRenameChat={handleRenameChat}
            onMoveToProject={handleMoveToProject}
            onReorderProject={reorderProjects}
            onSelectSession={handleSelectSession}
            onSelectSearchResult={handleSelectSearchResult}
            activeView={activeView}
            activeSettingsSection={activeSettingsSection}
            activeSessionId={visibleActiveSessionId}
            projects={projects}
            className="h-full"
          />
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for sidebar resize */}
        <div
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          className="flex-shrink-0 h-full cursor-col-resize group flex items-center justify-center"
          style={{ width: SIDEBAR_RESIZE_HANDLE_WIDTH }}
        >
          <div className="w-px h-8 rounded-full bg-transparent group-hover:bg-border transition-colors" />
        </div>

        <main className="min-h-0 min-w-0 flex-1">
          {children ?? (
            <AppShellContent
              activeView={activeView}
              activeSettingsSection={activeSettingsSection}
              activeSession={activeSession}
              homeSessionId={homeSessionId}
              onCreatePersona={handleCreatePersona}
              onArchiveChat={handleArchiveChat}
              onCreateProject={openCreateProjectDialog}
              onEnsureHomeSession={ensureHomeSession}
              onActivateHomeSession={activateHomeSession}
              onRenameChat={handleRenameChat}
              onSelectSession={handleSelectSession}
              onSelectSearchResult={handleSelectSearchResult}
              onStartChatFromProject={handleStartChatFromProject}
              onStartChatWithSkill={handleStartChatWithSkill}
            />
          )}
        </main>
      </div>

      <CreateProjectDialog
        isOpen={createProjectOpen}
        onClose={() => {
          setCreateProjectOpen(false);
          setEditingProject(null);
          setCreateProjectInitialWorkingDir(null);
          pendingProjectCreatedRef.current = null;
        }}
        onCreated={(project) => {
          fetchProjects();
          pendingProjectCreatedRef.current?.(project.id);
          pendingProjectCreatedRef.current = null;
          setCreateProjectInitialWorkingDir(null);
        }}
        initialWorkingDir={createProjectInitialWorkingDir}
        editingProject={editingProject ?? undefined}
      />
    </div>
  );
}
