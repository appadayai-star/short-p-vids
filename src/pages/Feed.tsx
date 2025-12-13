import { useSearchParams, useNavigate } from "react-router-dom";
import { VideoFeed } from "@/components/VideoFeed";
import { UploadModal } from "@/components/UploadModal";
import { BottomNav } from "@/components/BottomNav";
import { SEO } from "@/components/SEO";
import { EntryGate } from "@/components/EntryGate";
import { Search, X } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import { debugLog } from "@/lib/debugId";

const Feed = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || '';
  
  const { user, status: authStatus } = useAuth();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const unreadCount = useUnreadNotifications(user?.id || null);
  const { isAdmin } = useAdmin();

  debugLog("Feed", `Render`, { authStatus, userId: user?.id || null, refreshKey });

  const handleRefresh = () => {
    debugLog("Feed", "Home refresh triggered");
    setRefreshKey(prev => prev + 1);
  };

  return (
    <EntryGate>
      <div className="h-[100dvh] bg-black overflow-hidden flex flex-col relative">
        <SEO 
          title={categoryFilter ? `${categoryFilter} Videos` : undefined}
          description={categoryFilter 
            ? `Watch the best ${categoryFilter} videos on ShortPV` 
            : "Discover and share amazing short videos on ShortPV"
          }
        />
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

        <VideoFeed 
          key={refreshKey} 
          searchQuery={searchQuery} 
          categoryFilter={categoryFilter} 
          userId={user?.id || null} 
        />
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
    </EntryGate>
  );
};

export default Feed;
