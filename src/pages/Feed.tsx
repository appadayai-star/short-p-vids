import { useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VideoFeed } from "@/components/VideoFeed";
import { UploadModal } from "@/components/UploadModal";
import { BottomNav } from "@/components/BottomNav";
import { Search } from "lucide-react";

const Feed = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('search') || '';
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-primary text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black overflow-hidden flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-white/10 p-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-white text-xl font-bold">Feed</h1>
        <button
          onClick={() => navigate("/search")}
          className="p-2 hover:bg-white/5 rounded-full transition-colors"
        >
          <Search className="h-6 w-6 text-white" />
        </button>
      </div>

      <VideoFeed key={refreshKey} searchQuery={searchQuery} userId={user?.id || null} />
      <BottomNav
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!user}
        onHomeRefresh={handleRefresh}
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
