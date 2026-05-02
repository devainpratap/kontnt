import { Navigate, Route, Routes } from "react-router-dom";

import { JobWorkspacePage } from "./pages/JobWorkspacePage";
import { JobsPage } from "./pages/JobsPage";

export function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

