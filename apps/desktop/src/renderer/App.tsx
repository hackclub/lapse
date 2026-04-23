import { HashRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { RecordingProvider } from "./context/RecordingContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Recording } from "./pages/Recording";
import { Upload } from "./pages/Upload";
import { Settings } from "./pages/Settings";

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-neutral-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/recording" element={<Recording />} />
      <Route path="/upload" element={<Upload />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <RecordingProvider>
          <div className="flex h-screen flex-col overflow-hidden">
            <AppRoutes />
          </div>
        </RecordingProvider>
      </AuthProvider>
    </HashRouter>
  );
}
