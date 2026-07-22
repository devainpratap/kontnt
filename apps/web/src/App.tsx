import { Navigate, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { JobWorkspacePage } from "./pages/JobWorkspacePage";
import { JobsPage } from "./pages/JobsPage";

export function App() {
  return (
    <div className="app-shell">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
