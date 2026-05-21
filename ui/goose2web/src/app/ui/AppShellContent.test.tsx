import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShellContent } from "./AppShellContent";

vi.mock("@/features/recipes/ui/RecipesView", () => ({
  RecipesView: () => <div data-testid="recipes-view" />,
}));

function renderContent(
  activeView: React.ComponentProps<typeof AppShellContent>["activeView"],
) {
  return render(
    <AppShellContent
      activeView={activeView}
      activeSettingsSection="chats"
      homeSessionId={null}
      onCreatePersona={vi.fn()}
      onArchiveChat={vi.fn()}
      onCreateProject={vi.fn()}
      onEnsureHomeSession={vi.fn()}
      onActivateHomeSession={vi.fn()}
      onRenameChat={vi.fn()}
      onSelectSession={vi.fn()}
      onSelectSearchResult={vi.fn()}
      onStartChatFromProject={vi.fn()}
      onStartChatWithSkill={vi.fn()}
    />,
  );
}

describe("AppShellContent", () => {
  it("routes recipes view", () => {
    renderContent("recipes");

    expect(screen.getByTestId("recipes-view")).toBeInTheDocument();
  });
});
