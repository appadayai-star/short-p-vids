import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";

export const useAdmin = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdminStatus = async (userId: string): Promise<boolean> => {
      try {
        console.log("Checking admin status for user:", userId);
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle();

        console.log("Admin check result:", { data, error });
        
        if (error) {
          console.error("Error checking admin status:", error);
          return false;
        }
        return !!data;
      } catch (err) {
        console.error("Error in admin check:", err);
        return false;
      }
    };

    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const adminStatus = await checkAdminStatus(session.user.id);
        console.log("Setting isAdmin to:", adminStatus);
        setIsAdmin(adminStatus);
      }
      
      setLoading(false);
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          const adminStatus = await checkAdminStatus(session.user.id);
          console.log("Setting isAdmin to:", adminStatus);
          setIsAdmin(adminStatus);
        } else {
          setIsAdmin(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { user, isAdmin, loading };
};
