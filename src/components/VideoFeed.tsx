import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestVideoSource } from "@/lib/cloudinary";

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
  const [activeContainerRect, setActiveContainerRect] = useState<DOMRect | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const hasFetchedRef = useRef(false);
  const currentIndexRef = useRef(0);
  const isScrollLockedRef = useRef(false);

  // Handle item ref registration
  const handleContainerRef = useCallback((index: number, ref: HTMLDivElement | null) => {
    if (ref) {
      itemRefsRef.current.set(index, ref);
    } else {
      itemRefsRef.current.delete(index);
    }
  }, []);

  // Update active container rect when activeIndex or videos change
  useEffect(() => {
    const updateRect = () => {
      const activeContainer = itemRefsRef.current.get(activeIndex);
      if (activeContainer) {
        setActiveContainerRect(activeContainer.getBoundingClientRect());
      }
    };
    
    updateRect();
    const timers = [
      setTimeout(updateRect, 50),
      setTimeout(updateRect, 150),
    ];
    
    const handleUpdate = () => requestAnimationFrame(updateRect);
    window.addEventListener('resize', handleUpdate);
    containerRef.current?.addEventListener('scroll', handleUpdate);
    
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', handleUpdate);
      containerRef.current?.removeEventListener('scroll', handleUpdate);
    };
  }, [activeIndex, videos.length]);

  // Fetch videos - simple and direct
  const fetchVideos = useCallback(async () => {
    console.log(`[VideoFeed] Fetching videos...`);
    setIsLoading(true);
    setLoadError(null);
    setActiveIndex(0);
    currentIndexRef.current = 0;
    isScrollLockedRef.current = false;
    setPage(0);
    loadedIdsRef.current.clear();
    
    // Scroll to top
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }

    try {
      const isForYouFeed = !searchQuery && !categoryFilter;
      let fetchedVideos: Video[] = [];

      if (isForYouFeed) {
        // Use edge function for personalized feed
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: userId || null, page: 0, limit: PAGE_SIZE }
        });
        
        if (error) throw new Error(error.message || "Failed to load feed");
        fetchedVideos = data?.videos || [];
      } else {
        // Direct query for search/category
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);

        if (categoryFilter) {
          query = query.contains('tags', [categoryFilter]);
        }
        if (searchQuery) {
          query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        fetchedVideos = data || [];

        // Client-side search filtering
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          fetchedVideos = fetchedVideos.filter(v =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }
      }

      console.log(`[VideoFeed] Loaded ${fetchedVideos.length} videos`);
      fetchedVideos.forEach(v => loadedIdsRef.current.add(v.id));
      setVideos(fetchedVideos);
      setHasMore(fetchedVideos.length === PAGE_SIZE);

      // Warmup first video
      if (fetchedVideos.length > 0) {
        const first = fetchedVideos[0];
        const url = getBestVideoSource(
          first.cloudinary_public_id || null,
          first.optimized_video_url || null,
          first.stream_url || null,
          first.video_url
        );
        fetch(url, { method: 'HEAD', mode: 'cors' }).catch(() => {});
      }
    } catch (error) {
      console.error('[VideoFeed] Fetch error:', error);
      setLoadError(error instanceof Error ? error.message : "Failed to load videos");
      setVideos([]);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, categoryFilter, userId]);

  // Initial fetch on mount
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchVideos();
    }
  }, [fetchVideos]);

  // Re-fetch when filters change
  useEffect(() => {
    if (hasFetchedRef.current) {
      fetchVideos();
    }
  }, [searchQuery, categoryFilter]);

  // Load more videos
  const loadMoreVideos = useCallback(async (pageNum: number) => {
    if (isLoadingMore) return;
    
    setIsLoadingMore(true);
    console.log(`[VideoFeed] Loading page ${pageNum}...`);

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

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || isLoadingMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          const nextPage = page + 1;
          setPage(nextPage);
          loadMoreVideos(nextPage);
        }
      },
      { rootMargin: '200px' }
    );
    
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isLoading, page, loadMoreVideos]);

  // Keep ref in sync with state
  useEffect(() => {
    currentIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Simple scroll handling - one video at a time, no exceptions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const goToIndex = (index: number) => {
      const maxIndex = videos.length - 1;
      const targetIndex = Math.max(0, Math.min(index, maxIndex));
      const itemHeight = container.clientHeight;
      
      currentIndexRef.current = targetIndex;
      setActiveIndex(targetIndex);
      
      container.scrollTo({
        top: targetIndex * itemHeight,
        behavior: 'smooth'
      });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      if (isScrollLockedRef.current) return;
      
      const delta = e.deltaY;
      if (Math.abs(delta) < 5) return;
      
      isScrollLockedRef.current = true;
      
      const currentIdx = currentIndexRef.current;
      const nextIdx = delta > 0 ? currentIdx + 1 : currentIdx - 1;
      goToIndex(nextIdx);
      
      // Unlock after scroll animation completes
      setTimeout(() => {
        isScrollLockedRef.current = false;
      }, 400);
    };

    let touchStartY = 0;
    let touchStartIdx = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      touchStartIdx = currentIndexRef.current;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isScrollLockedRef.current) {
        goToIndex(touchStartIdx);
        return;
      }

      const endY = e.changedTouches[0].clientY;
      const diff = touchStartY - endY;
      
      if (Math.abs(diff) < 50) {
        goToIndex(touchStartIdx);
        return;
      }
      
      isScrollLockedRef.current = true;
      
      const nextIdx = diff > 0 ? touchStartIdx + 1 : touchStartIdx - 1;
      goToIndex(nextIdx);
      
      setTimeout(() => {
        isScrollLockedRef.current = false;
      }, 400);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [videos.length]);

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
          onClick={fetchVideos}
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

  const activeVideo = videos[activeIndex] || null;

  return (
    <div
      ref={containerRef}
      id="video-feed-container"
      className="w-full h-[100dvh] overflow-hidden scrollbar-hide"
      style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
    >
      <SinglePlayer
        video={activeVideo}
        containerRect={activeContainerRect}
        hasEntered={hasEntered}
        onViewTracked={handleViewTracked}
      />
      {videos.map((video, index) => (
        <FeedItem
          key={video.id}
          video={video}
          index={index}
          isActive={index === activeIndex}
          currentUserId={userId}
          onContainerRef={handleContainerRef}
        />
      ))}
      <div ref={sentinelRef} className="h-20 w-full" />
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};
