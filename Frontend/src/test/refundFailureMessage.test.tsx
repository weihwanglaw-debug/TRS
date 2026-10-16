import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ActionFeedbackDialog } from "@/components/ui/ActionFeedbackDialog";

it("renders gateway wording verbatim as text, including line breaks", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const message = 'Fiuu\nGateway error code: PR020\nGateway message:  <b>Exact wording</b>\nSecond line.  ';
  try {
    act(() => root.render(<ActionFeedbackDialog open variant="error" title="Refund failed"
      description={message} onOpenChange={() => {}} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    const description = dialog.querySelector(".whitespace-pre-wrap")!;
    expect(description.textContent).toBe(message);
    expect(description.className).toContain("whitespace-pre-wrap");
    expect(description.querySelector("b")).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
