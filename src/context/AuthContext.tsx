import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { getAdminUserForAuthUser } from "../services/adminUsersService";
import type { AdminUser } from "../types";

type AuthContextValue = {
  user: User | null;
  adminUser: AdminUser | null;
  isAdmin: boolean;
  isLoading: boolean;
  isFirebaseConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAdminUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAdminUser = useCallback(async () => {
    if (!auth?.currentUser) {
      setAdminUser(null);
      return;
    }
    const record = await getAdminUserForAuthUser(auth.currentUser);
    setAdminUser(record?.isActive ? record : null);
  }, []);

  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        const record = await getAdminUserForAuthUser(nextUser);
        setAdminUser(record?.isActive ? record : null);
      } else {
        setAdminUser(null);
      }
      setIsLoading(false);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error("Firebase is not configured.");
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      adminUser,
      isAdmin: Boolean(user && adminUser?.isActive),
      isLoading,
      isFirebaseConfigured,
      signIn,
      signOut,
      refreshAdminUser,
    }),
    [adminUser, isLoading, refreshAdminUser, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
