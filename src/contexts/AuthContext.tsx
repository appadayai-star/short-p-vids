import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthStatus = "booting" | "ready" | "error";

interface AuthContextType {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: Error | null;
}

const AuthContext = createContext<AuthContextType>({
  status: "booting",
  session: null,
  user: null,
  error: null,
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

  useEffect(() => {
    console.log("[AuthProvider] Initializing...");
    let mounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      console.log("[AuthProvider] Auth state changed:", event, newSession?.user?.id || "no user");
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // If we were booting and get an auth event, we're ready
      setStatus("ready");
    });

    // THEN get initial session
    supabase.auth.getSession()
      .then(({ data: { session: initialSession }, error: sessionError }) => {
        if (!mounted) return;
        
        if (sessionError) {
          console.error("[AuthProvider] Session error:", sessionError);
          setError(sessionError);
          setStatus("error");
          return;
        }
        
        console.log("[AuthProvider] Initial session:", initialSession?.user?.id || "no user");
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        setStatus("ready");
      })
      .catch((err) => {
        if (!mounted) return;
        console.error("[AuthProvider] Failed to get session:", err);
        setError(err);
        setStatus("error");
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  console.log("[AuthProvider] Rendering with status:", status);

  return (
    <AuthContext.Provider value={{ status, session, user, error }}>
      {children}
    </AuthContext.Provider>
  );
}
