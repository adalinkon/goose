import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { FilterRow } from "@/shared/ui/page-shell";
import type { RecipeFilter, RecipeProjectOption } from "../lib/recipeProjects";

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "default" : "outline-flat"}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

interface RecipesToolbarProps {
  activeFilter: RecipeFilter;
  onActiveFilterChange: (filter: RecipeFilter) => void;
  projects: RecipeProjectOption[];
}

export function RecipesToolbar({
  activeFilter,
  onActiveFilterChange,
  projects,
}: RecipesToolbarProps) {
  const { t } = useTranslation("recipes");

  return (
    <FilterRow>
      <FilterButton
        active={activeFilter === "global"}
        onClick={() => onActiveFilterChange("global")}
      >
        {t("view.filtersGlobal")}
      </FilterButton>
      {projects.map((project) => (
        <FilterButton
          key={project.id}
          active={activeFilter === `project:${project.id}`}
          onClick={() => onActiveFilterChange(`project:${project.id}`)}
        >
          {project.name}
        </FilterButton>
      ))}
    </FilterRow>
  );
}
