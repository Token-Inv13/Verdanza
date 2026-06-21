import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { getAdminUserForAuthUser } from "../services/adminUsersService";
import { ensureCustomerProfile } from "../services/customersService";
import type { AdminUser, CustomerProfile } from "../types";

type AuthContextValue = {
  user: User | null;
  adminUser: AdminUser | null;
  customerProfile: CustomerProfile | null;
  isAdmin: boolean;
  isLoading: boolean;
  isFirebaseConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAdminUser: () => Promise<void>;
  refreshCustomerProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAdminUser = useCallback(async () => {
    if (!auth?.currentUser) {
      setAdminUser(null);
      return;
    }
    const record = await getAdminUserForAuthUser(auth.currentUser);
    setAdminUser(record?.isActive ? record : null);
  }, []);

  const refreshCustomerProfile = useCallback(async () => {
    if (!auth?.currentUser) {
      setCustomerProfile(null);
      return;
    }
    const profile = await ensureCustomerProfile(auth.currentUser);
    setCustomerProfile(profile);
  }, []);

  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        const [record, profile] = await Promise.all([
          getAdminUserForAuthUser(nextUser),
          ensureCustomerProfile(nextUser),
        ]);
        setAdminUser(record?.isActive ? record : null);
        setCustomerProfile(profile);
      } else {
        setAdminUser(null);
        setCustomerProfile(null);
      }
      setIsLoading(false);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error("Firebase is not configured.");
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (!auth) throw new Error("Firebase is not configured.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      await ensureCustomerProfile(credential.user);
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!auth) throw new Error("Firebase is not configured.");
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error("Firebase is not configured.");
    await sendPasswordResetEmail(auth, email);
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      adminUser,
      customerProfile,
      isAdmin: Boolean(user && adminUser?.isActive),
      isLoading,
      isFirebaseConfigured,
      signIn,
      register,
      signInWithGoogle,
      resetPassword,
      signOut,
      refreshAdminUser,
      refreshCustomerProfile,
    }),
    [
      adminUser,
      customerProfile,
      isLoading,
      refreshAdminUser,
      refreshCustomerProfile,
      register,
      resetPassword,
      signIn,
      signInWithGoogle,
      signOut,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
