import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestVideoSource } from "@/lib/cloudinary";
import { useAuth } from "@/contexts/AuthContext";

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
  const { status: authStatus } = useAuth();
  
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
  const [retryCount, setRetryCount] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const fetchIdRef = useRef(0);

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

  // Initial fetch - runs when auth is ready and when filters change
  useEffect(() => {
    // Don't fetch until auth status is "ready" (not "booting")
    if (authStatus !== "ready") {
      console.log(`[VideoFeed] Waiting for auth... status: ${authStatus}`);
      return;
    }
    
    const currentFetchId = ++fetchIdRef.current;
    const abortController = new AbortController();
    
    const isForYouFeed = !searchQuery && !categoryFilter;
    console.log(`[VideoFeed] Starting fetch #${currentFetchId} (auth: ${authStatus}, forYou: ${isForYouFeed})`);
    
    // Reset state
    setPage(0);
    setActiveIndex(0);
    setIsLoading(true);
    setLoadError(null);
    setHasWarmedUp(false);
    setInitialLoadComplete(false);
    loadedIdsRef.current.clear();
    
    const doFetch = async () => {
      const startTime = Date.now();
      
      try {
        let videos: Video[] = [];
        
        if (isForYouFeed) {
          // Use the recommendation algorithm for the main "For You" feed
          console.log(`[VideoFeed] Calling get-for-you-feed edge function...`);
          const { data: fnData, error: fnError } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId: userId || null, page: 0, limit: PAGE_SIZE }
          });
          
          if (abortController.signal.aborted || currentFetchId !== fetchIdRef.current) return;
          
          if (fnError) {
            console.error(`[VideoFeed] Edge function error:`, fnError);
            throw new Error(fnError.message || "Failed to get recommendations");
          }
          
          videos = fnData?.videos || [];
          console.log(`[VideoFeed] Edge function returned ${videos.length} videos`);
        } else {
          // Use direct query for search/category filters
          let query = supabase
            .from("videos")
            .select(`
              id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, thumbnail_url,
              views_count, likes_count, tags, user_id,
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
          
          if (abortController.signal.aborted || currentFetchId !== fetchIdRef.current) return;
          if (error) throw error;

          videos = data || [];
          
          // Additional client-side filtering for search
          if (searchQuery && videos.length > 0) {
            const q = searchQuery.toLowerCase();
            videos = videos.filter(v => 
              v.title?.toLowerCase().includes(q) ||
              v.description?.toLowerCase().includes(q) ||
              v.profiles?.username?.toLowerCase().includes(q) ||
              v.tags?.some(t => t.toLowerCase().includes(q))
            );
          }
        }
        
        const duration = Date.now() - startTime;
        console.log(`[VideoFeed] Fetch #${currentFetchId} done in ${duration}ms: ${videos.length} videos`);

        loadedIdsRef.current.clear();
        videos.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(videos);
        setHasMore(videos.length === PAGE_SIZE);
        setLoadError(null);
        setInitialLoadComplete(true);
        setRetryCount(0);
      } catch (error) {
        if (abortController.signal.aborted || currentFetchId !== fetchIdRef.current) return;
        
        const errorMessage = error instanceof Error ? error.message : "Failed to load videos";
        console.error(`[VideoFeed] Fetch #${currentFetchId} error:`, errorMessage);
        
        // Auto-retry once on first failure
        if (retryCount === 0) {
          console.log(`[VideoFeed] Auto-retrying in 500ms...`);
          setRetryCount(1);
          setTimeout(() => {
            if (!abortController.signal.aborted) {
              setRetryCount(prev => prev + 1);
            }
          }, 500);
          return;
        }
        
        setVideos([]);
        setLoadError(errorMessage);
      } finally {
        if (!abortController.signal.aborted && currentFetchId === fetchIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    doFetch();
    
    return () => {
      abortController.abort();
      console.log(`[VideoFeed] Cleanup fetch #${currentFetchId}`);
    };
  }, [searchQuery, categoryFilter, retryCount, authStatus, userId]);

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

  // Infinite scroll - load more pages
  const loadMoreVideos = useCallback(async (pageNum: number) => {
    if (isLoadingMore) return;
    
    setIsLoadingMore(true);
    const isForYouFeed = !searchQuery && !categoryFilter;
    console.log(`[VideoFeed] Loading more - page ${pageNum} (forYou: ${isForYouFeed})`);
    
    try {
      let newVideos: Video[] = [];
      
      if (isForYouFeed) {
        // Use the recommendation algorithm for pagination
        const { data: fnData, error: fnError } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: userId || null, page: pageNum, limit: PAGE_SIZE }
        });
        
        if (fnError) throw new Error(fnError.message || "Failed to load more");
        
        newVideos = (fnData?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
      } else {
        // Use direct query for search/category filters
        const offset = pageNum * PAGE_SIZE;
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, thumbnail_url,
            views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (categoryFilter) {
          query = query.contains('tags', [categoryFilter]);
        }
        if (searchQuery) {
          query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
        }

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
  }, [searchQuery, categoryFilter, isLoadingMore, userId]);

  useEffect(() => {
    if (!initialLoadComplete || !sentinelRef.current || !hasMore || isLoadingMore) {
      return;
    }
    
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
  }, [hasMore, isLoadingMore, page, initialLoadComplete, loadMoreVideos]);

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
    console.log('[VideoFeed] Manual retry triggered');
    setRetryCount(prev => prev + 1);
  };

  // Show loading while auth is booting or feed is loading
  if (authStatus === "booting" || isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">
          {authStatus === "booting" ? "Initializing..." : "Loading videos..."}
        </p>
      </div>
    );
  }

  // Show auth error state
  if (authStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-red-400 text-lg text-center px-4">Failed to initialize app</p>
        <button 
          onClick={() => window.location.reload()} 
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Reload Page
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-red-400 text-lg text-center px-4">{loadError}</p>
        <button 
          onClick={handleRetry} 
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
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
