import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_ICON,
  isImageProjectIcon,
  normalizeProjectIcon,
} from "./projectIcons";

describe("projectIcons", () => {
  it("normalizes empty and legacy folder icons to the default preset", () => {
    expect(normalizeProjectIcon(null)).toBe(DEFAULT_PROJECT_ICON);
    expect(normalizeProjectIcon(undefined)).toBe(DEFAULT_PROJECT_ICON);
    expect(normalizeProjectIcon("\u{1F4C1}")).toBe(DEFAULT_PROJECT_ICON);
  });

  it("preserves explicit icon values", () => {
    expect(normalizeProjectIcon("tabler:code")).toBe("tabler:code");
    expect(normalizeProjectIcon("data:image/png;base64,aWNvbg==")).toBe(
      "data:image/png;base64,aWNvbg==",
    );
  });

  it("identifies browser image-backed icon values", () => {
    expect(isImageProjectIcon("data:image/svg+xml;base64,aWNvbg==")).toBe(true);
    expect(isImageProjectIcon(DEFAULT_PROJECT_ICON)).toBe(false);
  });
});
