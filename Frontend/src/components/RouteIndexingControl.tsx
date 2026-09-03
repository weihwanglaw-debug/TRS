import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { robotsContentForPath } from "@/lib/routeIndexing";

export function RouteIndexingControl() {
  const { pathname } = useLocation();

  useEffect(() => {
    let robotsMeta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement("meta");
      robotsMeta.name = "robots";
      document.head.appendChild(robotsMeta);
    }

    robotsMeta.content = robotsContentForPath(pathname);
  }, [pathname]);

  return null;
}
