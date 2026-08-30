
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { registerServiceWorker } from "./app/lib/push";
  import "./styles/index.css";

  registerServiceWorker();
  createRoot(document.getElementById("root")!).render(<App />);
  