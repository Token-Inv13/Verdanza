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
import {
  getAdminUserForAuthUser,
  isAdminRecordForAuthUser,
} from "../services/adminUsersService";
import {
  createCustomerProfileIfMissing,
  getCustomerProfile,
  updateCustomerProfile,
} from "../services/customersService";
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
  saveCustomerProfile: (data: Pick<CustomerProfile, "displayName" | "phone">) => Promise<void>;
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

  // A Firebase observer or explicit refresh can finish after a newer identity,
  // refresh, or profile write. Only the latest matching revision may publish.
  const authRevision = useRef(0);
  const adminRevision = useRef(0);
  const profileRevision = useRef(0);
  const observedUid = useRef<string | null>(null);

  const invalidatePendingReads = useCallback(() => {
    ++authRevision.current;
    ++adminRevision.current;
    ++profileRevision.current;
  }, []);

  const refreshAdminUser = useCallback(async () => {
    const revision = ++adminRevision.current;
    const session = authRevision.current;
    const uid = observedUid.current;
    const auth = await getFirebaseAuth();
    if (session !== authRevision.current || uid !== observedUid.current) return;
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== uid) {
      if (revision === adminRevision.current && uid === null) setAdminUser(null);
      return;
    }
    const record = await getAdminUserForAuthUser(currentUser);
    if (
      session === authRevision.current &&
      revision === adminRevision.current &&
      observedUid.current === uid &&
      auth?.currentUser?.uid === uid
    ) {
      setAdminUser(isAdminRecordForAuthUser(record, currentUser) ? record : null);
    }
  }, []);

  const refreshCustomerProfile = useCallback(async () => {
    const revision = ++profileRevision.current;
    const session = authRevision.current;
    const uid = observedUid.current;
    const auth = await getFirebaseAuth();
    if (session !== authRevision.current || uid !== observedUid.current) return;
    if (!auth?.currentUser || auth.currentUser.uid !== uid) {
      if (revision === profileRevision.current && uid === null) setCustomerProfile(null);
      return;
    }
    const profile = await getCustomerProfile(uid);
    if (
      session === authRevision.current &&
      revision === profileRevision.current &&
      observedUid.current === uid &&
      auth.currentUser?.uid === uid
    ) {
      setCustomerProfile(profile);
    }
  }, []);

  const publishExplicitProfile = useCallback(async (authUser: FirebaseUser) => {
    const auth = await getFirebaseAuth();
    if (auth?.currentUser?.uid !== authUser.uid) return;
    if (observedUid.current !== authUser.uid) {
      ++authRevision.current;
      ++adminRevision.current;
      ++profileRevision.current;
      observedUid.current = authUser.uid;
      setUser(authUser);
      setAdminUser(null);
      setCustomerProfile(null);
    }
    ++profileRevision.current;
    const profile = await createCustomerProfileIfMissing(authUser);
    if (observedUid.current !== authUser.uid || auth.currentUser?.uid !== authUser.uid) return;
    // The explicit write wins over a read that started before the transaction.
    ++profileRevision.current;
    setCustomerProfile(profile);
  }, []);

  const saveCustomerProfile = useCallback(async (data: Pick<CustomerProfile, "displayName" | "phone">) => {
    const session = authRevision.current;
    const uid = observedUid.current;
    const auth = await getFirebaseAuth();
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== uid || session !== authRevision.current) {
      throw new Error("Session expirée. Reconnectez-vous.");
    }
    ++profileRevision.current;
    await createCustomerProfileIfMissing(currentUser);
    const profile = await updateCustomerProfile(uid, data);
    // A completed explicit save supersedes reads started by a later same-UID Auth event.
    if (
      observedUid.current === uid &&
      auth.currentUser?.uid === uid
    ) {
      ++profileRevision.current;
      setCustomerProfile(profile);
    }
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

    void loadFirebaseAuthApi().then(({ auth, firebaseAuth }) => {
      if (cancelled) return;
      if (!auth) {
        setIsLoading(false);
        return;
      }

      unsubscribe = firebaseAuth.onAuthStateChanged(auth, async (nextUser) => {
        if (cancelled) return;
        const session = ++authRevision.current;
        const adminRead = ++adminRevision.current;
        const profileRead = ++profileRevision.current;
        observedUid.current = nextUser?.uid ?? null;
        setUser(nextUser);
        setAdminUser(null);
        setCustomerProfile(null);
        if (!nextUser) {
          setIsLoading(false);
          return;
        }
        setIsLoading(true);
        const [adminResult, profileResult] = await Promise.allSettled([
          getAdminUserForAuthUser(nextUser),
          getCustomerProfile(nextUser.uid),
        ]);
        if (
          cancelled ||
          session !== authRevision.current ||
          observedUid.current !== nextUser.uid ||
          auth.currentUser?.uid !== nextUser.uid
        ) return;
        if (adminRead === adminRevision.current) {
          const record = adminResult.status === "fulfilled" ? adminResult.value : null;
          setAdminUser(isAdminRecordForAuthUser(record, nextUser) ? record : null);
        }
        if (profileRead === profileRevision.current) {
          setCustomerProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
        }
        setIsLoading(false);
      });
    });

    return () => {
      cancelled = true;
      invalidatePendingReads();
      unsubscribe?.();
    };
  }, [invalidatePendingReads, location.pathname]);

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
      await publishExplicitProfile(credential.user);
    },
    [publishExplicitProfile],
  );

  const signInWithGoogle = useCallback(async () => {
    const { auth, firebaseAuth } = await loadFirebaseAuthApi();
    if (!auth) throw new Error("Firebase is not configured.");
    const provider = new firebaseAuth.GoogleAuthProvider();
    const credential = await firebaseAuth.signInWithPopup(auth, provider);
    if (firebaseAuth.getAdditionalUserInfo(credential)?.isNewUser === true) {
      await publishExplicitProfile(credential.user);
    }
  }, [publishExplicitProfile]);

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
      isAdmin: isAdminRecordForAuthUser(adminUser, user),
      isLoading,
      isFirebaseConfigured,
      signIn,
      register,
      signInWithGoogle,
      resetPassword,
      signOut,
      refreshAdminUser,
      refreshCustomerProfile,
      saveCustomerProfile,
    }),
    [
      adminUser,
      customerProfile,
      isLoading,
      refreshAdminUser,
      refreshCustomerProfile,
      register,
      resetPassword,
      saveCustomerProfile,
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
