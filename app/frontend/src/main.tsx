import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./hooks/use-auth";
import { router } from "./router";
import { shouldRetry } from "./lib/errors";
import { applySeo } from "./lib/seo";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});

// tela quebrada avisa quem administra (sem dados de formulário; no máximo 5 por sessão)
let reported = 0;
const reportClientError = (message: string) => {
  if (import.meta.env.DEV || reported >= 5 || !message || /ResizeObserver|Failed to fetch dynamically imported module|Load failed|NetworkError/i.test(message)) return;
  reported++;
  void fetch("/api/monitoring/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.slice(0, 500), path: window.location.pathname }), keepalive: true }).catch(() => undefined);
};
window.addEventListener("error", (e) => reportClientError(e.message || String(e.error ?? "")));
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { status?: number; message?: string } | undefined;
  // erro de API já tratado pelas telas (4xx/5xx com mensagem) não é tela quebrada
  if (r && typeof r.status === "number") return;
  reportClientError(r?.message ?? String(e.reason ?? ""));
});

// título, descrição e noindex acompanham a rota
applySeo(window.location.pathname);
router.subscribe((state) => applySeo(state.location.pathname));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
