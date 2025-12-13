import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useEntryGate } from "./EntryGate";

const PAGE_SIZE = 10;
const SCROLL_DEBOUNCE_MS = 30;

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  tags: string[] | null;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface VideoFeedProps {
  searchQuery: string;
  categoryFilter: string;
  userId: string | null;
}

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect active video based on scroll position - trigger at 40% threshold for faster response
  const updateActiveIndex = useCallback(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;
    
    const scrollTop = container.scrollTop;
    const itemHeight = container.clientHeight;
    // Use floor + 0.4 offset to trigger earlier (when 40% of next video is visible)
    const newIndex = Math.floor((scrollTop + itemHeight * 0.4) / itemHeight);
    
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex);
    }
  }, [activeIndex, videos.length]);

  // Scroll handler with debounce
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(updateActiveIndex, SCROLL_DEBOUNCE_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [updateActiveIndex]);

  // Fetch videos
  const fetchVideos = useCallback(async (currentSearchQuery: string, currentCategoryFilter: string, currentUserId: string | null) => {
    console.log(`[VideoFeed] Fetching videos...`);
    setIsLoading(true);
    setLoadError(null);
    setActiveIndex(0);
    setPage(0);
    loadedIdsRef.current.clear();
    
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }

    try {
      const isForYouFeed = !currentSearchQuery && !currentCategoryFilter;
      let fetchedVideos: Video[] = [];

      if (isForYouFeed) {
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: currentUserId, page: 0, limit: PAGE_SIZE }
        });
        
        if (error) throw new Error(error.message || "Failed to load feed");
        fetchedVideos = data?.videos || [];
      } else {
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);

        if (currentCategoryFilter) {
          query = query.contains('tags', [currentCategoryFilter]);
        }
        if (currentSearchQuery) {
          query = query.or(`title.ilike.%${currentSearchQuery}%,description.ilike.%${currentSearchQuery}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        fetchedVideos = data || [];

        if (currentSearchQuery) {
          const q = currentSearchQuery.toLowerCase();
          fetchedVideos = fetchedVideos.filter(v =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }
      }

      fetchedVideos.forEach(v => loadedIdsRef.current.add(v.id));
      setVideos(fetchedVideos);
      setHasMore(fetchedVideos.length === PAGE_SIZE);
    } catch (error) {
      console.error('[VideoFeed] Fetch error:', error);
      setLoadError(error instanceof Error ? error.message : "Failed to load videos");
      setVideos([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchVideos(searchQuery, categoryFilter, userId);
  }, [searchQuery, categoryFilter, fetchVideos]);

  // Load more videos
  const loadMoreVideos = useCallback(async (pageNum: number) => {
    if (isLoadingMore) return;
    
    setIsLoadingMore(true);

    try {
      const isForYouFeed = !searchQuery && !categoryFilter;
      let newVideos: Video[] = [];

      if (isForYouFeed) {
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: userId || null, page: pageNum, limit: PAGE_SIZE }
        });
        if (error) throw new Error(error.message);
        newVideos = (data?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
      } else {
        const offset = pageNum * PAGE_SIZE;
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url,
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (categoryFilter) query = query.contains('tags', [categoryFilter]);
        if (searchQuery) query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);

        const { data, error } = await query;
        if (error) throw error;
        newVideos = (data || []).filter(v => !loadedIdsRef.current.has(v.id));
      }

      newVideos.forEach(v => loadedIdsRef.current.add(v.id));
      setVideos(prev => [...prev, ...newVideos]);
      setHasMore(newVideos.length > 0);
    } catch (error) {
      console.error('[VideoFeed] Load more error:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchQuery, categoryFilter, userId, isLoadingMore]);

  // Load more when approaching end
  useEffect(() => {
    if (!hasMore || isLoadingMore || isLoading) return;
    
    if (activeIndex >= videos.length - 3 && videos.length > 0) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadMoreVideos(nextPage);
    }
  }, [activeIndex, videos.length, hasMore, isLoadingMore, isLoading, page, loadMoreVideos]);

  // Track video view
  const handleViewTracked = useCallback(async (videoId: string) => {
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch {}
  }, [userId]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-red-400 text-lg text-center px-4">{loadError}</p>
        <button
          onClick={() => fetchVideos(searchQuery, categoryFilter, userId)}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-black">
        <p className="text-primary text-lg">
          {searchQuery ? "No videos found" : categoryFilter ? `No videos in ${categoryFilter}` : "No videos yet"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[100dvh] overflow-y-scroll overflow-x-hidden scrollbar-hide bg-black"
      style={{ 
        scrollSnapType: 'y mandatory',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {videos.map((video, index) => (
        <FeedItem
          key={video.id}
          video={video}
          index={index}
          isActive={index === activeIndex}
          hasEntered={hasEntered}
          currentUserId={userId}
          onViewTracked={handleViewTracked}
          isMobile
        />
      ))}
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black h-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};
