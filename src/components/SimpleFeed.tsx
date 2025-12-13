import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";

const PAGE_SIZE = 10;

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

interface SimpleFeedProps {
  searchQuery: string;
  categoryFilter: string;
  userId: string | null;
}

export function SimpleFeed({ searchQuery, categoryFilter, userId }: SimpleFeedProps) {
  const { hasEntered } = useEntryGate();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIds = useRef<Set<string>>(new Set());
  const page = useRef(0);
  const hasFetched = useRef(false);
  
  // Use ref to track current index for event handlers (avoids stale closure)
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  
  // Scroll control refs
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch using the smart algorithm edge function
  const fetchVideos = useCallback(async (reset = true) => {
    console.log("[SimpleFeed] fetchVideos called, reset:", reset);
    
    if (reset) {
      setLoading(true);
      setError(null);
      setActiveIndex(0);
      page.current = 0;
      loadedIds.current.clear();
    }

    try {
      let fetchedVideos: Video[] = [];

      // Use edge function for personalized feed (no filters)
      if (!searchQuery && !categoryFilter) {
        console.log("[SimpleFeed] Using edge function for personalized feed");
        const { data, error: fnError } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId, page: page.current, limit: PAGE_SIZE }
        });

        if (fnError) {
          console.error("[SimpleFeed] Edge function error:", fnError);
          throw fnError;
        }

        fetchedVideos = data?.videos || [];
        console.log("[SimpleFeed] Edge function returned", fetchedVideos.length, "videos");
      } else {
        // Direct query for search/category filters
        console.log("[SimpleFeed] Using direct query for filtered feed");
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id
          `)
          .order("created_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);

        if (categoryFilter) {
          query = query.contains('tags', [categoryFilter]);
        }
        
        if (searchQuery) {
          query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
        }

        const { data, error: fetchError } = await query;
        if (fetchError) throw fetchError;

        const rawVideos = data || [];
        
        // Fetch profiles separately
        if (rawVideos.length > 0) {
          const userIds = [...new Set(rawVideos.map(v => v.user_id))];
          const { data: profilesData } = await supabase
            .from("profiles_public")
            .select("id, username, avatar_url")
            .in("id", userIds);
          
          const profilesMap = new Map(
            (profilesData || []).map(p => [p.id, { username: p.username || 'User', avatar_url: p.avatar_url }])
          );
          
          fetchedVideos = rawVideos.map(v => ({
            ...v,
            profiles: profilesMap.get(v.user_id) || { username: 'User', avatar_url: null }
          }));
        }
      }
      
      fetchedVideos.forEach(v => loadedIds.current.add(v.id));
      setVideos(fetchedVideos);
      setHasMore(fetchedVideos.length === PAGE_SIZE);
    } catch (err) {
      console.error("[SimpleFeed] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load videos");
    } finally {
      setLoading(false);
    }
  }, [userId, searchQuery, categoryFilter]);

  // Initial load - ONLY ONCE
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchVideos(true);
  }, [fetchVideos]);

  // Re-fetch when filters change
  const prevFiltersRef = useRef({ searchQuery, categoryFilter });
  useEffect(() => {
    if (
      prevFiltersRef.current.searchQuery !== searchQuery ||
      prevFiltersRef.current.categoryFilter !== categoryFilter
    ) {
      prevFiltersRef.current = { searchQuery, categoryFilter };
      hasFetched.current = true;
      fetchVideos(true);
    }
  }, [searchQuery, categoryFilter, fetchVideos]);

  // Load more
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    page.current += 1;

    try {
      if (!searchQuery && !categoryFilter) {
        const { data } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId, page: page.current, limit: PAGE_SIZE }
        });
        
        const newVideos = (data?.videos || []).filter((v: Video) => !loadedIds.current.has(v.id));
        newVideos.forEach((v: Video) => loadedIds.current.add(v.id));
        setVideos(prev => [...prev, ...newVideos]);
        setHasMore(newVideos.length > 0);
      } else {
        const offset = page.current * PAGE_SIZE;
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id
          `)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (categoryFilter) query = query.contains('tags', [categoryFilter]);
        if (searchQuery) query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);

        const { data } = await query;
        const rawVideos = (data || []).filter(v => !loadedIds.current.has(v.id));
        
        if (rawVideos.length > 0) {
          const userIds = [...new Set(rawVideos.map(v => v.user_id))];
          const { data: profilesData } = await supabase
            .from("profiles_public")
            .select("id, username, avatar_url")
            .in("id", userIds);
          
          const profilesMap = new Map(
            (profilesData || []).map(p => [p.id, { username: p.username || 'User', avatar_url: p.avatar_url }])
          );
          
          const newVideos = rawVideos.map(v => ({
            ...v,
            profiles: profilesMap.get(v.user_id) || { username: 'User', avatar_url: null }
          }));
          
          newVideos.forEach(v => loadedIds.current.add(v.id));
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error("[SimpleFeed] Load more error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, userId, searchQuery, categoryFilter]);

  // Navigate to video index
  const goToVideo = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= videos.length) return;
    
    setActiveIndex(newIndex);
    
    // Scroll to the video
    const container = containerRef.current;
    if (container) {
      container.scrollTo({
        top: newIndex * window.innerHeight,
        behavior: 'smooth'
      });
    }
    
    // Load more when near end
    if (newIndex >= videos.length - 3 && hasMore && !loadingMore) {
      loadMore();
    }
  }, [videos.length, hasMore, loadingMore, loadMore]);

  // Wheel handler - ONE video at a time
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let accumulatedDelta = 0;
    const THRESHOLD = 50;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      if (isScrollingRef.current) return;
      
      accumulatedDelta += e.deltaY;
      
      if (Math.abs(accumulatedDelta) >= THRESHOLD) {
        isScrollingRef.current = true;
        const direction = accumulatedDelta > 0 ? 1 : -1;
        const currentIndex = activeIndexRef.current;
        const newIndex = currentIndex + direction;
        
        if (newIndex >= 0 && newIndex < videos.length) {
          goToVideo(newIndex);
        }
        
        accumulatedDelta = 0;
        
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          isScrollingRef.current = false;
        }, 400);
      }
    };

    // Touch handling
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isScrollingRef.current) return;
      
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchStartY - touchEndY;
      
      if (Math.abs(deltaY) > 60) {
        isScrollingRef.current = true;
        const direction = deltaY > 0 ? 1 : -1;
        const currentIndex = activeIndexRef.current;
        const newIndex = currentIndex + direction;
        
        if (newIndex >= 0 && newIndex < videos.length) {
          goToVideo(newIndex);
        }
        
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          isScrollingRef.current = false;
        }, 400);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      clearTimeout(scrollTimeoutRef.current);
    };
  }, [videos.length, goToVideo]);

  // Track view
  const handleViewTracked = useCallback(async (videoId: string) => {
    if (!userId) return;
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch {}
  }, [userId]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-6">
        <p className="text-red-400 text-center">{error}</p>
        <button
          onClick={() => { hasFetched.current = false; fetchVideos(); }}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-black">
        <p className="text-muted-foreground">
          {searchQuery ? "No videos found" : categoryFilter ? `No videos in ${categoryFilter}` : "No videos yet"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id="video-feed-container"
      className="w-full h-[100dvh] overflow-y-auto overflow-x-hidden snap-y snap-mandatory scrollbar-hide"
      style={{ 
        scrollSnapType: 'y mandatory',
        scrollBehavior: 'smooth',
        overscrollBehavior: 'none'
      }}
    >
      {videos.map((video, index) => (
        <FeedItem
          key={video.id}
          video={video}
          index={index}
          isActive={index === activeIndex}
          currentUserId={userId}
          hasEntered={hasEntered}
          onViewTracked={handleViewTracked}
        />
      ))}
      
      {/* Loading more indicator */}
      {loadingMore && (
        <div className="flex justify-center py-4 bg-black snap-start">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
