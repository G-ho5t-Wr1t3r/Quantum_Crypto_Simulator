import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { AppearanceProvider } from "./app/appearance";
import "./index.css";

// Retrying is wrong here: a 422 means the configuration is impossible and a
// second identical request will be refused identically, while a 429 means the
// server is already busy and retrying makes that worse.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppearanceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
