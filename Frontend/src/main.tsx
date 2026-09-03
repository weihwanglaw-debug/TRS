import { createRoot } from "react-dom/client";
import "./index.css";
import { loadRuntimeConfig } from "./lib/api/_base";

async function bootstrap() {
  await loadRuntimeConfig();
  const { default: App } = await import("./App.tsx");
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
