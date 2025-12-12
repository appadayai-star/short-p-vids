import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Global state - shared across all components
let isClientReady = false;
let readyPromise: Promise<void> | null = null;
const readyListeners: Set<() => void> = new Set();

// Initialize the client once globally
function initializeClient(): Promise<void> {
  if (readyPromise) return readyPromise;
  
  readyPromise = new Promise<void>((resolve) => {
    console.log("[Auth] Starting global client initialization");
    
    // Call getSession to ensure the client is fully initialized
    // This forces Supabase to load session from localStorage
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log("[Auth] Client initialized, session:", session?.user?.id || "none", "error:", error?.message || "none");
      isClientReady = true;
      readyListeners.forEach(listener => listener());
      resolve();
    }).catch((err) => {
      console.error("[Auth] Client initialization error:", err);
      // Still mark as ready so app doesn't hang
      isClientReady = true;
      readyListeners.forEach(listener => listener());
      resolve();
    });
  });
  
  return readyPromise;
}

// Start initialization immediately when this module is imported
initializeClient();

/**
 * Hook that returns true when the Supabase client is ready to make requests.
 * Use this to gate any Supabase queries until the client is initialized.
 */
export function useAuthReady(): boolean {
  const [ready, setReady] = useState(isClientReady);
  
  useEffect(() => {
    if (isClientReady) {
      setReady(true);
      return;
    }
    
    const listener = () => setReady(true);
    readyListeners.add(listener);
    
    // Also trigger initialization in case it hasn't started
    initializeClient();
    
    return () => {
      readyListeners.delete(listener);
    };
  }, []);
  
  return ready;
}

/**
 * Wait for the Supabase client to be ready.
 * Use this in async functions before making Supabase requests.
 */
export async function waitForAuthReady(): Promise<void> {
  if (isClientReady) return;
  return initializeClient();
}
