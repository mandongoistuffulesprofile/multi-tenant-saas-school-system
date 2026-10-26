import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../lib/authStore";

interface RequireRoleProps {
  roles: string[];
  children: React.ReactNode;
  fallbackPath?: string;
}

/**
 * Route guard that checks the authenticated user's roles.
 * - If the user has ANY of the required roles, render children.
 * - Otherwise redirect to fallbackPath (default: "/dashboard").
 */
export default function RequireRole({ roles, children, fallbackPath = "/dashboard" }: RequireRoleProps) {
  const userRoles = useAuthStore((state) => state.roles);
  const location = useLocation();

  const hasRole = roles.some((r) => userRoles.includes(r));
  if (!hasRole) {
    return <Navigate to={fallbackPath} state={{ from: location }} replace />;
  }
  return <>{children}</>;
}