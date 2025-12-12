import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2, RefreshCw } from "lucide-react";
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
  const [hasWarmedUp, setHasWarmedUp] = useState(false);
  const [activeContainerRect, setActiveContainerRect] = useState<DOMRect | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const isFetchingRef = useRef(false);

  const handleContainerRef = useCallback((index: number, ref: HTMLDivElement | null) => {
    if (ref) {
      itemRefsRef.current.set(index, ref);
    } else {
      itemRefsRef.current.delete(index);
    }
  }, []);

  // Update active container rect
  useEffect(() => {
    const updateRect = () => {
      const activeContainer = itemRefsRef.current.get(activeIndex);
      if (activeContainer) {
        setActiveContainerRect(activeContainer.getBoundingClientRect());
      }
    };
    
    updateRect();
    const t1 = setTimeout(updateRect, 50);
    const t2 = setTimeout(updateRect, 150);
    const t3 = setTimeout(updateRect, 300);
    
    const handleUpdate = () => requestAnimationFrame(updateRect);
    window.addEventListener('resize', handleUpdate);
    const container = containerRef.current;
    container?.addEventListener('scroll', handleUpdate);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', handleUpdate);
      container?.removeEventListener('scroll', handleUpdate);
    };
  }, [activeIndex, videos.length]);

  // Core fetch function - completely standalone, no useCallback wrapper
  const doFetch = async (pageNum: number, search: string, category: string, append: boolean) => {
    // Prevent duplicate fetches
    if (isFetchingRef.current && pageNum === 0) {
      console.log('[VideoFeed] Skipping duplicate fetch');
      return;
    }
    
    isFetchingRef.current = true;
    console.log(`[VideoFeed] doFetch START: page=${pageNum}, search="${search}", category="${category}"`);
    const startTime = Date.now();
    
    try {
      const offset = pageNum * PAGE_SIZE;
      
      // Build query step by step
      let query = supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, thumbnail_url,
          views_count, likes_count, tags, user_id,
          profiles(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (category) {
        query = query.contains('tags', [category]);
      }
      if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      }

      const { data, error } = await query;
      
      const duration = Date.now() - startTime;
      console.log(`[VideoFeed] doFetch DONE in ${duration}ms: ${data?.length || 0} videos, error:`, error?.message || 'none');
      
      if (error) throw error;

      let filtered = data || [];
      
      // Additional client-side filtering for username/tags
      if (search && data) {
        const q = search.toLowerCase();
        filtered = data.filter(v => 
          v.title?.toLowerCase().includes(q) ||
          v.description?.toLowerCase().includes(q) ||
          v.profiles?.username?.toLowerCase().includes(q) ||
          v.tags?.some(t => t.toLowerCase().includes(q))
        );
      }

      if (pageNum === 0) {
        loadedIdsRef.current.clear();
        filtered.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(filtered);
      } else {
        const newVideos = filtered.filter(v => !loadedIdsRef.current.has(v.id));
        newVideos.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(prev => [...prev, ...newVideos]);
      }

      setHasMore(data?.length === PAGE_SIZE);
      setLoadError(null);
      setInitialLoadComplete(true);
    } catch (error) {
      console.error(`[VideoFeed] doFetch ERROR:`, error);
      if (!append) {
        setVideos([]);
        setLoadError(error instanceof Error ? error.message : "Failed to load videos");
      }
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Initial fetch - runs on mount and when filters change
  useEffect(() => {
    console.log("[VideoFeed] Effect triggered - resetting and fetching");
    
    // Reset state
    setPage(0);
    setActiveIndex(0);
    setIsLoading(true);
    setLoadError(null);
    setHasWarmedUp(false);
    setInitialLoadComplete(false);
    loadedIdsRef.current.clear();
    
    // Fetch immediately
    doFetch(0, searchQuery, categoryFilter, false);
  }, [searchQuery, categoryFilter]); // NO function dependencies!

  // Warmup first video
  useEffect(() => {
    if (hasWarmedUp || videos.length === 0) return;
    const firstVideo = videos[0];
    const videoUrl = getBestVideoSource(
      firstVideo.cloudinary_public_id || null,
      firstVideo.optimized_video_url || null,
      firstVideo.stream_url || null,
      firstVideo.video_url
    );
    fetch(videoUrl, { method: 'HEAD', mode: 'cors' }).catch(() => {});
    setHasWarmedUp(true);
  }, [videos, hasWarmedUp]);

  // Infinite scroll - only after initial load
  useEffect(() => {
    if (!initialLoadComplete || !sentinelRef.current || !hasMore || isLoadingMore) {
      return;
    }
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isFetchingRef.current) {
          const nextPage = page + 1;
          console.log(`[VideoFeed] Loading more - page ${nextPage}`);
          setPage(nextPage);
          setIsLoadingMore(true);
          doFetch(nextPage, searchQuery, categoryFilter, true);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, page, initialLoadComplete, searchQuery, categoryFilter]);

  // Scroll tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;
    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const itemHeight = container.clientHeight;
      const newIndex = Math.round(scrollTop / itemHeight);
      if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
        setActiveIndex(newIndex);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeIndex, videos.length]);

  const handleViewTracked = useCallback(async (videoId: string) => {
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch (error) {}
  }, [userId]);

  const handleRetry = () => {
    console.log('[VideoFeed] Retry triggered');
    setLoadError(null);
    setIsLoading(true);
    doFetch(0, searchQuery, categoryFilter, false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4">
        <p className="text-red-400 text-lg text-center px-4">{loadError}</p>
        <button onClick={handleRetry} className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg">
          <RefreshCw className="h-5 w-5" /> Tap to Retry
        </button>
      </div>
    );
  }

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
      className="w-full h-[100dvh] snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scrollbar-hide" 
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
