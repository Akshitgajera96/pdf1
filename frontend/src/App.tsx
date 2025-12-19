import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import BatchSeries from "./pages/BatchSeries";
import Viewer from "./pages/Viewer";
import Demo from "./pages/Demo";
import Auth from "./pages/Auth";
import CreateUser from "./pages/CreateUser";
import Printing from "./pages/Printing";
import NotFound from "./pages/NotFound";
import AdminUsersSessions from "./pages/AdminUsersSessions";
import Security from "./pages/Security";
import ErrorBoundary from "./components/ErrorBoundary";

const queryClient = new QueryClient();

// Protected route component
const ProtectedRoute = ({ children, adminOnly = false }: { children: React.ReactNode, adminOnly?: boolean }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (adminOnly && user.role !== 'ADMIN') {
    // Non-admin ko admin pages se printing dashboard pe bhejo
    return <Navigate to="/printing" replace />;
  }

  return <>{children}</>;
};

const getDefaultAuthedPath = (user: any) => {
  return user?.role === 'ADMIN' ? '/upload' : '/printing';
};

const HomeRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <Navigate to={getDefaultAuthedPath(user)} replace />;
};

// Auth route component (login/register pages)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (user) {
    return <Navigate to={getDefaultAuthedPath(user)} replace />;
  }

  return <>{children}</>;
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter
            future={{
              v7_relativeSplatPath: true,
              v7_startTransition: true,
            }}
          >
            <Routes>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/login" element={
                <AuthRoute>
                  <Auth />
                </AuthRoute>
              } />
              <Route path="/upload" element={
                <ProtectedRoute adminOnly>
                  <Upload />
                </ProtectedRoute>
              } />
              <Route path="/batch-series" element={
                <ProtectedRoute adminOnly>
                  <BatchSeries />
                </ProtectedRoute>
              } />
              <Route path="/viewer" element={
                <ProtectedRoute>
                  <Viewer />
                </ProtectedRoute>
              } />
              <Route path="/demo" element={<Demo />} />
              <Route path="/auth" element={
                <AuthRoute>
                  <Auth />
                </AuthRoute>
              } />
              <Route path="/create-user" element={
                <ProtectedRoute adminOnly>
                  <CreateUser />
                </ProtectedRoute>
              } />
              <Route path="/admin/users" element={
                <ProtectedRoute adminOnly>
                  <AdminUsersSessions />
                </ProtectedRoute>
              } />
              <Route path="/printing" element={
                <ProtectedRoute>
                  <Printing />
                </ProtectedRoute>
              } />
              <Route path="/security" element={
                <ProtectedRoute>
                  <Security />
                </ProtectedRoute>
              } />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
