import { useEffect, useState } from "react";
import { apiGetEvents } from "@/lib/api";

export const eventIntegrationMessage = "This event is ready for integration. No changes are allowed. Cancel Event Integration to make changes.";

// This is an admin UI restriction; payment and refund APIs are independent.
export function useEventIntegration() {
  const [ready, setReady] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const reload = () => {
      const request = ++latestRequest;
      void apiGetEvents({ includeInactive: true }).then(result => {
        if (active && request === latestRequest && result.data)
          setReady(new Map(result.data.map(event => [event.id, !!event.readyForEventIntegration])));
      }).catch(() => {});
    };
    reload();
    window.addEventListener("focus", reload);
    return () => { active = false; window.removeEventListener("focus", reload); };
  }, []);
  // Keep editing unavailable until the event's flag has been loaded.
  return (eventId: string) => ready.get(eventId) !== false;
}
