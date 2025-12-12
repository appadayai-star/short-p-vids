import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestVideoSource } from "@/lib/cloudinary";

const PAGE_SIZE = 10;
const FETCH_TIMEOUT_MS = 10000; // 10 second hard timeout

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

// Generate unique request ID for logging
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Fetch with timeout and abort support
async function fetchWithTimeout<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  requestId: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error(`[VideoFeed][${requestId}] Request timeout after ${timeoutMs}ms - aborting`);
    controller.abort();
  }, timeoutMs);

  try {
    const result = await fetchFn(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }
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
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Fetch videos with timeout protection
  const fetchVideos = useCallback(async () => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    
    console.log(`[VideoFeed][${requestId}] Starting fetch - route: ${window.location.pathname}, userId: ${userId || 'null'}, search: "${searchQuery}", category: "${categoryFilter}"`);
    
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setIsLoading(true);
    setLoadError(null);
    setActiveIndex(0);
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
        // Use edge function with timeout
        console.log(`[VideoFeed][${requestId}] Calling get-for-you-feed edge function...`);
        
        const result = await fetchWithTimeout(
          async (signal) => {
            // Note: supabase.functions.invoke doesn't support AbortSignal directly,
            // so we implement a race condition with the timeout
            const fetchPromise = supabase.functions.invoke('get-for-you-feed', {
              body: { userId: userId || null, page: 0, limit: PAGE_SIZE }
            });
            
            // Check if aborted before awaiting
            if (signal.aborted) {
              throw new Error('Request aborted');
            }
            
            return fetchPromise;
          },
          FETCH_TIMEOUT_MS,
          requestId
        );
        
        if (result.error) {
          console.error(`[VideoFeed][${requestId}] Edge function error:`, result.error);
          throw new Error(result.error.message || "Failed to load feed");
        }
        
        fetchedVideos = result.data?.videos || [];
        console.log(`[VideoFeed][${requestId}] Edge function returned ${fetchedVideos.length} videos`);
      } else {
        // Direct query for search/category with timeout
        console.log(`[VideoFeed][${requestId}] Direct Supabase query...`);
        
        const result = await fetchWithTimeout(
          async () => {
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

            return query;
          },
          FETCH_TIMEOUT_MS,
          requestId
        );
        
        if (result.error) throw result.error;
        fetchedVideos = result.data || [];

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

      const elapsed = Date.now() - startTime;
      console.log(`[VideoFeed][${requestId}] Fetch completed in ${elapsed}ms - loaded ${fetchedVideos.length} videos`);
      
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
      const elapsed = Date.now() - startTime;
      console.error(`[VideoFeed][${requestId}] Fetch FAILED after ${elapsed}ms:`, error);
      
      const errorMessage = error instanceof Error ? error.message : "Failed to load videos";
      setLoadError(errorMessage);
      setVideos([]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [searchQuery, categoryFilter, userId]);

  // Initial fetch on mount - DO NOT wait for auth
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      console.log(`[VideoFeed] Initial mount fetch triggered`);
      fetchVideos();
    }
    
    // Cleanup: abort on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchVideos]);

  // Re-fetch when filters change
  useEffect(() => {
    if (hasFetchedRef.current) {
      fetchVideos();
    }
  }, [searchQuery, categoryFilter]);

  // Load more videos with timeout
  const loadMoreVideos = useCallback(async (pageNum: number) => {
    if (isLoadingMore) return;
    
    const requestId = generateRequestId();
    setIsLoadingMore(true);
    console.log(`[VideoFeed][${requestId}] Loading page ${pageNum}...`);

    try {
      const isForYouFeed = !searchQuery && !categoryFilter;
      let newVideos: Video[] = [];

      if (isForYouFeed) {
        const result = await fetchWithTimeout(
          async () => supabase.functions.invoke('get-for-you-feed', {
            body: { userId: userId || null, page: pageNum, limit: PAGE_SIZE }
          }),
          FETCH_TIMEOUT_MS,
          requestId
        );
        
        if (result.error) throw new Error(result.error.message);
        newVideos = (result.data?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
      } else {
        const offset = pageNum * PAGE_SIZE;
        const result = await fetchWithTimeout(
          async () => {
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

            return query;
          },
          FETCH_TIMEOUT_MS,
          requestId
        );
        
        if (result.error) throw result.error;
        newVideos = (result.data || []).filter(v => !loadedIdsRef.current.has(v.id));
      }

      console.log(`[VideoFeed][${requestId}] Loaded ${newVideos.length} more videos`);
      newVideos.forEach(v => loadedIdsRef.current.add(v.id));
      setVideos(prev => [...prev, ...newVideos]);
      setHasMore(newVideos.length > 0);
    } catch (error) {
      console.error(`[VideoFeed][${requestId}] Load more error:`, error);
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

  // Scroll tracking for active video
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

  // Error state with retry button
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-6">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-red-400 text-lg text-center">{loadError}</p>
        <button
          onClick={() => {
            hasFetchedRef.current = false;
            fetchVideos();
          }}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
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
