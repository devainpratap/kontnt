import { Navigate, Route, Routes } from "react-router-dom";

import { AppHeader } from "./components/AppHeader";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { ClientsPage } from "./pages/ClientsPage";
import { InsightsPage } from "./pages/InsightsPage";
import { KeywordsPage } from "./pages/KeywordsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <div className="app-shell">
      <AppHeader />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientDetailPage />} />
          <Route path="/clients/:clientId/keywords" element={<KeywordsPage />} />
          <Route path="/clients/:clientId/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
