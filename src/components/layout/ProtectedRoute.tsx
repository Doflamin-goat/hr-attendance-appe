import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth, type AppRole } from "../../context/AuthContext";

export function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: AppRole[] }) {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-600">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
