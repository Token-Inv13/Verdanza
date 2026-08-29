import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { isFirebaseConfigured } from "../lib/firebase";
import {
  getFirebaseAuth,
  loadFirebaseAuthApi,
  type FirebaseUser,
} from "../lib/firebaseAuth";
import { firebaseAuthActionCodeSettings } from "../lib/firebaseAuthActions";
import { getAdminUserForAuthUser } from "../services/adminUsersService";
import { ensureCustomerProfile } from "../services/customersService";
import type { AdminUser, CustomerProfile } from "../types";

type AuthContextValue = {
  user: FirebaseUser | null;
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

function shouldLoadAuthImmediately(pathname: string) {
  return /^(\/admin|\/compte|\/connexion|\/inscription|\/panier|\/checkout|\/auth\/action|\/blog\/[^/]+)(?:\/|$)/.test(
    pathname,
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasStartedAuth = useRef(false);

  const refreshAdminUser = useCallback(async () => {
    const auth = await getFirebaseAuth();
    if (!auth?.currentUser) {
      setAdminUser(null);
      return;
    }
    const record = await getAdminUserForAuthUser(auth.currentUser);
    setAdminUser(record?.isActive ? record : null);
  }, []);

  const refreshCustomerProfile = useCallback(async () => {
    const auth = await getFirebaseAuth();
    if (!auth?.currentUser) {
      setCustomerProfile(null);
      return;
    }
    const profile = await ensureCustomerProfile(auth.currentUser);
    setCustomerProfile(profile);
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    if (!shouldLoadAuthImmediately(location.pathname) && !hasStartedAuth.current) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    hasStartedAuth.current = true;
    setIsLoading(true);

    const startAuth = () => {
      void loadFirebaseAuthApi().then(({ auth, firebaseAuth }) => {
        if (cancelled) return;
        if (!auth) {
          setIsLoading(false);
          return;
        }

        unsubscribe = firebaseAuth.onAuthStateChanged(auth, async (nextUser) => {
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
      });
    };

    startAuth();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [location.pathname]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { auth, firebaseAuth } = await loadFirebaseAuthApi();
    if (!auth) throw new Error("Firebase is not configured.");
    await firebaseAuth.signInWithEmailAndPassword(auth, email, password);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { auth, firebaseAuth } = await loadFirebaseAuthApi();
      if (!auth) throw new Error("Firebase is not configured.");
      const credential = await firebaseAuth.createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      if (displayName.trim()) {
        await firebaseAuth.updateProfile(credential.user, {
          displayName: displayName.trim(),
        });
      }
      await ensureCustomerProfile(credential.user);
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    const { auth, firebaseAuth } = await loadFirebaseAuthApi();
    if (!auth) throw new Error("Firebase is not configured.");
    const provider = new firebaseAuth.GoogleAuthProvider();
    await firebaseAuth.signInWithPopup(auth, provider);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { auth, firebaseAuth } = await loadFirebaseAuthApi();
    if (!auth) throw new Error("Firebase is not configured.");
    await firebaseAuth.sendPasswordResetEmail(auth, email, firebaseAuthActionCodeSettings);
  }, []);

  const signOut = useCallback(async () => {
    const { auth, firebaseAuth } = await loadFirebaseAuthApi();
    if (!auth) return;
    await firebaseAuth.signOut(auth);
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
