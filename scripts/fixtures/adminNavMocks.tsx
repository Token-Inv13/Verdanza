/* eslint-disable react-refresh/only-export-components -- fixture intentionally mocks both auth and components */
import type { ReactNode } from "react";

export function useAuth() {
  return { adminUser: { email: "admin@fixture.test" }, signOut: async () => {} };
}

export function Seo() { return null; }
export function BrandLogo({ className }: { className?: string }) {
  return <div className={className}>Verdanza</div>;
}

export function MockPage({ children }: { children?: ReactNode }) { return <div>{children}</div>; }
