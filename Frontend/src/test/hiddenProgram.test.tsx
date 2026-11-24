import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatusBadge, { getProgramCapacityStatus } from "@/components/events/StatusBadge";
import { getProgramRegistrationPresentation } from "@/lib/eventUtils";
import type { Program } from "@/types/config";

describe("Hidden programs", () => {
  it("keeps Hidden ahead of Full and rejects public signup", () => {
    const status = getProgramCapacityStatus({ status: "H", currentParticipants: 10, maxParticipants: 10 } as Program);
    expect(status).toBe("H");
    expect(getProgramRegistrationPresentation({
      eventStatus: "O", programDisplayStatus: status, isAuthenticated: false,
    }).canRegister).toBe(false);
  });
  it("uses the existing themed badge for Hidden", () => {
    const html = renderToStaticMarkup(<StatusBadge status="H" />);
    expect(html).toContain("Hidden");
    expect(html).toContain("var(--badge-closed-bg)");
  });
});
