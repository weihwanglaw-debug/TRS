import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RouteIndexingControl } from "@/components/RouteIndexingControl";
import { robotsContentForPath } from "@/lib/routeIndexing";

describe("route indexing controls", () => {
  it.each([
    ["/admin", "noindex, nofollow, noarchive"],
    ["/admin/events/12", "noindex, nofollow, noarchive"],
    ["/login", "noindex, nofollow, noarchive"],
    ["/payment/result", "noindex, nofollow, noarchive"],
    ["/events", "index, follow"],
  ])("maps %s to %s", (path, expected) => {
    expect(robotsContentForPath(path)).toBe(expected);
  });

  it("updates the robots meta tag for a sensitive route", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={["/admin/fixtures"]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RouteIndexingControl />
        </MemoryRouter>,
      );
    });

    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content"))
      .toBe("noindex, nofollow, noarchive");

    act(() => root.unmount());
    container.remove();
  });
});
