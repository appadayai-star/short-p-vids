import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthStatus = "booting" | "ready" | "error";

interface AuthContextType {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: Error | null;
  bootTimestamp: number | null;
}

const AuthContext = createContext<AuthContextType>({
  status: "booting",
  session: null,
  user: null,
  error: null,
  bootTimestamp: null,
});

export function useAuth() {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: ReactNode;
}

// Hard timeout for auth bootstrap - if we can't determine session in 3s, proceed anyway
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000;

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [bootTimestamp, setBootTimestamp] = useState<number | null>(null);

  useEffect(() => {
    const startTime = Date.now();
    console.log(`[AuthProvider] Initializing at ${new Date().toISOString()}`);
    let mounted = true;
    let hasSetReady = false;

    const markReady = (source: string) => {
      if (hasSetReady || !mounted) return;
      hasSetReady = true;
      const elapsed = Date.now() - startTime;
      console.log(`[AuthProvider] Ready via ${source} after ${elapsed}ms`);
      setBootTimestamp(Date.now());
      setStatus("ready");
    };

    // Hard timeout - NEVER stay in booting state forever
    const timeoutId = setTimeout(() => {
      if (!hasSetReady && mounted) {
        console.warn(`[AuthProvider] Bootstrap timeout after ${AUTH_BOOTSTRAP_TIMEOUT_MS}ms - proceeding without session`);
        markReady("timeout");
      }
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      console.log(`[AuthProvider] Auth state changed: ${event}`, newSession?.user?.id || "no user");
      setSession(newSession);
      setUser(newSession?.user ?? null);
      markReady("onAuthStateChange");
    });

    // THEN get initial session
    supabase.auth.getSession()
      .then(({ data: { session: initialSession }, error: sessionError }) => {
        if (!mounted) return;
        
        if (sessionError) {
          console.error("[AuthProvider] Session error:", sessionError);
          setError(sessionError);
          // Still mark as ready - we can proceed without auth
          markReady("getSession-error");
          return;
        }
        
        console.log("[AuthProvider] Initial session:", initialSession?.user?.id || "no user");
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        markReady("getSession");
      })
      .catch((err) => {
        if (!mounted) return;
        console.error("[AuthProvider] Failed to get session:", err);
        setError(err);
        // Still mark as ready - we can proceed without auth
        markReady("getSession-catch");
      });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  console.log("[AuthProvider] Rendering with status:", status);

  return (
    <AuthContext.Provider value={{ status, session, user, error, bootTimestamp }}>
      {children}
    </AuthContext.Provider>
  );
}
