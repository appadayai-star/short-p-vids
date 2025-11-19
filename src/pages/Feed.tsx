import { useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VideoFeed } from "@/components/VideoFeed";
import { UploadModal } from "@/components/UploadModal";
import { BottomNav } from "@/components/BottomNav";

const Feed = () => {
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('search') || '';
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-primary text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black overflow-hidden">
      <VideoFeed searchQuery={searchQuery} userId={user?.id || null} />
      <BottomNav
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!user}
      />
      {user && (
        <UploadModal 
          open={isUploadOpen} 
          onOpenChange={setIsUploadOpen}
          userId={user.id}
        />
      )}
    </div>
  );
};

export default Feed;
