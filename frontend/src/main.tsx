import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/ui";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e: any) => e?.status !== 401 && n < 2, refetchOnWindowFocus: true, staleTime: 1000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
