import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionActivityIndicator } from "./SessionActivityIndicator";

describe("SessionActivityIndicator", () => {
  it("renders an inline spinner for running sessions", () => {
    render(<SessionActivityIndicator isRunning />);

    expect(screen.getByLabelText(/chat active/i)).toBeInTheDocument();
  });

  it("renders an inline dot for unread sessions", () => {
    render(<SessionActivityIndicator hasUnread />);

    expect(screen.getByLabelText(/unread messages/i)).toBeInTheDocument();
  });

  it("renders an overlay spinner variant for running sessions", () => {
    render(<SessionActivityIndicator isRunning variant="overlay" />);

    expect(screen.getByLabelText(/chat active/i)).toBeInTheDocument();
  });

  it("renders a waiting dot for wait status", () => {
    render(<SessionActivityIndicator status="wait" />);

    expect(screen.getByLabelText(/chat waiting/i)).toBeInTheDocument();
  });

  it("renders an unavailable dot for dead status", () => {
    render(<SessionActivityIndicator status="dead" />);

    expect(screen.getByLabelText(/chat unavailable/i)).toBeInTheDocument();
  });

  it("renders an idle dot when requested", () => {
    render(<SessionActivityIndicator showIdle />);

    expect(screen.getByLabelText(/chat idle/i)).toBeInTheDocument();
  });

  it("renders nothing when the session is idle and read", () => {
    const { container } = render(<SessionActivityIndicator />);

    expect(container).toBeEmptyDOMElement();
  });
});
