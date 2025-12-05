import { useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VideoFeed } from "@/components/VideoFeed";
import { UploadModal } from "@/components/UploadModal";
import { BottomNav } from "@/components/BottomNav";
import { Search, X } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useAdmin } from "@/hooks/useAdmin";

const Feed = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || '';
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const unreadCount = useUnreadNotifications(user?.id || null);
  const { isAdmin } = useAdmin();

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
    <div className="h-screen bg-black overflow-hidden flex flex-col relative">
      {/* Category filter indicator */}
      {categoryFilter && (
        <button
          onClick={() => navigate("/")}
          className="fixed top-4 left-4 z-50 px-4 py-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors flex items-center gap-2"
        >
          <span className="text-white font-medium capitalize">{categoryFilter}</span>
          <X className="h-5 w-5 text-white" />
        </button>
      )}

      {/* Search button */}
      <button
        onClick={() => navigate("/search")}
        className="fixed top-4 right-4 z-50 p-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors"
      >
        <Search className="h-6 w-6 text-white" />
      </button>

      <VideoFeed key={refreshKey} searchQuery={searchQuery} categoryFilter={categoryFilter} userId={user?.id || null} />
      <BottomNav
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!user}
        onHomeRefresh={handleRefresh}
        unreadCount={unreadCount}
        isAdmin={isAdmin}
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
