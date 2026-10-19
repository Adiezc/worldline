import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./index.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Console helpers to preview the HUD without a server (see src/dev/mock.ts).
if (import.meta.env.DEV) void import("./dev/mock.ts");
