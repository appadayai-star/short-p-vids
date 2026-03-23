import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthStatus = "loading" | "ready";

interface AuthContextType {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
}

const AuthContext = createContext<AuthContextType>({
  status: "loading",
  session: null,
  user: null,
});

export function useAuth() {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Listen first so we never miss auth state transitions
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setStatus("ready");
    });

    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();

        if (!initialSession) {
          setSession(null);
          setUser(null);
          setStatus("ready");
          return;
        }

        // Validate stored session; if stale/revoked, try refresh once
        const { data: userData, error: userError } = await supabase.auth.getUser(initialSession.access_token);

        if (userError || !userData.user) {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
            refresh_token: initialSession.refresh_token,
          });

          if (refreshError || !refreshed.session) {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
          } else {
            setSession(refreshed.session);
            setUser(refreshed.user ?? refreshed.session.user ?? null);
          }
        } else {
          setSession(initialSession);
          setUser(userData.user);
        }
      } catch {
        setSession(null);
        setUser(null);
      } finally {
        setStatus("ready");
      }
    };

    initializeAuth();

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, user }}>
      {children}
    </AuthContext.Provider>
  );
}
