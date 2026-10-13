"use client";

import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { AppWorkspace } from "@/components/AppWorkspace";

function HomeInner() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="muted">加载中…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-page">
        <div className="muted">正在跳转登录…</div>
      </div>
    );
  }

  return <AppWorkspace />;
}

export default function HomePage() {
  return (
    <AuthProvider>
      <HomeInner />
    </AuthProvider>
  );
}
