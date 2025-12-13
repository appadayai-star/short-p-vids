import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export const useAdmin = () => {
  const { status, user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "ready") return;

    const checkAdminStatus = async () => {
      if (!user) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        console.log("Checking admin status for user:", user.id);
        
        // Use raw fetch to avoid Supabase client hanging
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${user.id}&role=eq.admin&select=role`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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
  }, [status, user?.id]);

  return { user, isAdmin, loading };
};
