import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export const useAdmin = () => {
  const { status, user, session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "ready") return;

    const checkAdminStatus = async () => {
      if (!user || !session?.access_token) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        console.log("Checking admin status for user:", user.id);
        
        // Use raw fetch with the user's access token for proper RLS
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${user.id}&role=eq.admin&select=role`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        const data = await response.json();
        console.log("Admin check result:", data);
        
        const adminStatus = Array.isArray(data) && data.length > 0;
        console.log("Setting isAdmin to:", adminStatus);
        setIsAdmin(adminStatus);
      } catch (err) {
        console.error("Error checking admin status:", err);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [status, user?.id, session?.access_token]);

  return { user, isAdmin, loading };
};
