import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { debugLog, debugError, getDebugId } from "@/lib/debugId";

type AuthStatus = "booting" | "ready" | "error";

interface AuthContextType {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: Error | null;
  debugId: string;
}

const AuthContext = createContext<AuthContextType>({
  status: "booting",
  session: null,
  user: null,
  error: null,
  debugId: "",
});

export function useAuth() {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const debugId = getDebugId();

  useEffect(() => {
    debugLog("AuthProvider", "Initializing auth...", { route: window.location.pathname });
    let mounted = true;
    let sessionResolved = false;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      
      debugLog("AuthProvider", `onAuthStateChange: ${event}`, {
        userId: newSession?.user?.id || null,
        hasAccessToken: !!newSession?.access_token,
        expiresAt: newSession?.expires_at,
      });

      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      // Mark ready on any auth state change if we haven't resolved yet
      if (!sessionResolved) {
        sessionResolved = true;
        setStatus("ready");
        debugLog("AuthProvider", "Auth ready (via onAuthStateChange)");
      }
    });

    // THEN get initial session with timeout
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Session fetch timeout after 5s")), 5000);
    });

    debugLog("AuthProvider", "Calling getSession()...");
    
    Promise.race([sessionPromise, timeoutPromise])
      .then(({ data: { session: initialSession }, error: sessionError }) => {
        if (!mounted) return;
        
        if (sessionError) {
          debugError("AuthProvider", "getSession error", sessionError);
          setError(sessionError);
          setStatus("error");
          return;
        }
        
        debugLog("AuthProvider", "getSession resolved", {
          userId: initialSession?.user?.id || null,
          hasAccessToken: !!initialSession?.access_token,
        });
        
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        
        if (!sessionResolved) {
          sessionResolved = true;
          setStatus("ready");
          debugLog("AuthProvider", "Auth ready (via getSession)");
        }
      })
      .catch((err) => {
        if (!mounted) return;
        debugError("AuthProvider", "getSession failed/timeout", err);
        
        // Even on timeout, mark as ready with no user (don't block forever)
        if (!sessionResolved) {
          sessionResolved = true;
          setStatus("ready");
          debugLog("AuthProvider", "Auth ready (fallback after timeout, no user)");
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  debugLog("AuthProvider", `Render: status=${status}, userId=${user?.id || 'none'}`);

  return (
    <AuthContext.Provider value={{ status, session, user, error, debugId }}>
      {children}
    </AuthContext.Provider>
  );
}
