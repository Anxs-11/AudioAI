import { Navigate, Route, Routes } from "react-router-dom";
import { isLoggedIn } from "./api";
import Login from "./pages/Login";
import Upload from "./pages/Upload";
import Results from "./pages/Results";
import History from "./pages/History";
import Layout from "./components/Layout";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  return isLoggedIn() ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <Upload />
          </ProtectedRoute>
        }
      />
      <Route
        path="/results/:batchId"
        element={
          <ProtectedRoute>
            <Results />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <History />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to={isLoggedIn() ? "/upload" : "/login"} replace />} />
    </Routes>
  );
}
