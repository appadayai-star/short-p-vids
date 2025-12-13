import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw, AlertTriangle, Bug } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage } from "@/lib/cloudinary";
import { useAuth } from "@/contexts/AuthContext";
import { debugLog, debugError, getDebugId } from "@/lib/debugId";

const PAGE_SIZE = 10;
const SCROLL_DEBOUNCE_MS = 30;
const FETCH_TIMEOUT_MS = 10000;
const RETRY_DELAYS = [250, 1000, 3000];

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

interface FetchState {
  loading: boolean;
  error: string | null;
  lastAttempt: number | null;
  attemptCount: number;
  videoCount: number;
  source: string | null;
  duration: number | null;
}

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  const { status: authStatus } = useAuth();
  const debugId = getDebugId();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>({
    loading: true,
    error: null,
    lastAttempt: null,
    attemptCount: 0,
    videoCount: 0,
    source: null,
    duration: null,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIndexRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchInProgressRef = useRef(false);

  // Check for debug mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDebug(params.get('debug') === '1' || import.meta.env.DEV);
  }, []);

  // Preload next video's thumbnail only
  const preloadNextVideo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= videos.length) return;
    
    const nextVideo = videos[nextIndex];
    if (!nextVideo) return;

    const thumbnailUrl = getBestThumbnailUrl(
      nextVideo.cloudinary_public_id || null,
      nextVideo.thumbnail_url
    );
    preloadImage(thumbnailUrl);
  }, [videos]);

  // Detect active video based on scroll position
  const updateActiveIndex = useCallback(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;
    
    const scrollTop = container.scrollTop;
    const itemHeight = container.clientHeight;
    const newIndex = Math.floor((scrollTop + itemHeight * 0.4) / itemHeight);
    
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex);
      
      if (newIndex > prevActiveIndexRef.current) {
        preloadNextVideo(newIndex + 1);
      } else if (newIndex < prevActiveIndexRef.current) {
        preloadNextVideo(newIndex - 1);
      }
      prevActiveIndexRef.current = newIndex;
    }
  }, [activeIndex, videos.length, preloadNextVideo]);

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

  // Centralized fetch with retry logic, timeout, and proper error handling
  const fetchFeed = useCallback(async (
    currentSearchQuery: string, 
    currentCategoryFilter: string, 
    currentUserId: string | null,
    retryAttempt = 0
  ): Promise<void> => {
    // Prevent concurrent fetches
    if (fetchInProgressRef.current && retryAttempt === 0) {
      debugLog("VideoFeed", "Fetch already in progress, skipping");
      return;
    }

    fetchInProgressRef.current = true;
    const startTime = Date.now();
    const isForYouFeed = !currentSearchQuery && !currentCategoryFilter;
    const source = isForYouFeed ? "edge-function" : "direct-query";

    debugLog("VideoFeed", `Fetch starting`, {
      attempt: retryAttempt + 1,
      source,
      searchQuery: currentSearchQuery,
      categoryFilter: currentCategoryFilter,
      userId: currentUserId,
    });

    setFetchState(prev => ({
      ...prev,
      loading: true,
      error: null,
      lastAttempt: startTime,
      attemptCount: retryAttempt + 1,
      source,
    }));

    if (retryAttempt === 0) {
      setActiveIndex(0);
      setPage(0);
      loadedIdsRef.current.clear();
      prevActiveIndexRef.current = 0;
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
    });

    try {
      let fetchedVideos: Video[] = [];

      // Helper function for direct database query (fallback)
      const fetchFromDatabase = async (): Promise<Video[]> => {
        debugLog("VideoFeed", "Using direct database query");
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
        
        let videos = data || [];
        if (currentSearchQuery) {
          const q = currentSearchQuery.toLowerCase();
          videos = videos.filter(v =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }
        return videos;
      };

      if (isForYouFeed) {
        try {
          // Try edge function first with a shorter timeout
          const edgeFunctionTimeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Edge function timeout")), 5000);
          });

          const fetchPromise = supabase.functions.invoke('get-for-you-feed', {
            body: { userId: currentUserId, page: 0, limit: PAGE_SIZE },
            headers: { 'x-debug-id': debugId },
          });

          const { data, error } = await Promise.race([fetchPromise, edgeFunctionTimeout]);
          
          if (signal.aborted) {
            debugLog("VideoFeed", "Fetch aborted");
            return;
          }
          
          if (error) {
            debugError("VideoFeed", "Edge function error, falling back to direct query", error);
            fetchedVideos = await fetchFromDatabase();
          } else {
            fetchedVideos = data?.videos || [];
            debugLog("VideoFeed", `Edge function returned ${fetchedVideos.length} videos`);
          }
        } catch (edgeError) {
          // Edge function failed, fallback to direct database query
          debugLog("VideoFeed", "Edge function failed, using fallback", edgeError);
          fetchedVideos = await fetchFromDatabase();
        }
      } else {
        fetchedVideos = await fetchFromDatabase();
      }

      const duration = Date.now() - startTime;
      debugLog("VideoFeed", `Fetch success`, {
        duration: `${duration}ms`,
        videoCount: fetchedVideos.length,
        firstVideoId: fetchedVideos[0]?.id || null,
      });

      fetchedVideos.forEach(v => loadedIdsRef.current.add(v.id));
      setVideos(fetchedVideos);
      setHasMore(fetchedVideos.length === PAGE_SIZE);
      
      setFetchState({
        loading: false,
        error: null,
        lastAttempt: startTime,
        attemptCount: retryAttempt + 1,
        videoCount: fetchedVideos.length,
        source,
        duration,
      });

      // Preload second video's thumbnail
      if (fetchedVideos.length > 1) {
        const secondVideo = fetchedVideos[1];
        preloadImage(getBestThumbnailUrl(secondVideo.cloudinary_public_id || null, secondVideo.thumbnail_url));
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Failed to load videos";
      
      debugError("VideoFeed", `Fetch failed`, { error: errorMessage, duration: `${duration}ms`, attempt: retryAttempt + 1 });

      // Retry with backoff if not max attempts
      if (retryAttempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[retryAttempt];
        debugLog("VideoFeed", `Retrying in ${delay}ms...`);
        
        setTimeout(() => {
          fetchFeed(currentSearchQuery, currentCategoryFilter, currentUserId, retryAttempt + 1);
        }, delay);
        return;
      }

      // All retries exhausted
      setFetchState({
        loading: false,
        error: errorMessage,
        lastAttempt: startTime,
        attemptCount: retryAttempt + 1,
        videoCount: 0,
        source,
        duration,
      });
      setVideos([]);
    } finally {
      fetchInProgressRef.current = false;
    }
  }, [debugId]);

  // Wait for auth to be ready before fetching
  useEffect(() => {
    if (authStatus !== "ready") {
      debugLog("VideoFeed", `Waiting for auth (status: ${authStatus})`);
      return;
    }

    debugLog("VideoFeed", "Auth ready, initiating fetch", { userId });
    fetchFeed(searchQuery, categoryFilter, userId);
    
    // Cleanup
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [authStatus, searchQuery, categoryFilter, userId, fetchFeed]);

  // Load more videos
  const loadMoreVideos = useCallback(async (pageNum: number) => {
    if (isLoadingMore) return;
    
    setIsLoadingMore(true);

    try {
      const isForYouFeed = !searchQuery && !categoryFilter;
      let newVideos: Video[] = [];

      if (isForYouFeed) {
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: userId || null, page: pageNum, limit: PAGE_SIZE },
          headers: { 'x-debug-id': debugId },
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
      debugError("VideoFeed", "Load more error", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchQuery, categoryFilter, userId, isLoadingMore, debugId]);

  // Load more when approaching end
  useEffect(() => {
    if (!hasMore || isLoadingMore || fetchState.loading) return;
    
    if (activeIndex >= videos.length - 3 && videos.length > 0) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadMoreVideos(nextPage);
    }
  }, [activeIndex, videos.length, hasMore, isLoadingMore, fetchState.loading, page, loadMoreVideos]);

  // Track video view
  const handleViewTracked = useCallback(async (videoId: string) => {
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch {}
  }, [userId]);

  const handleRetry = () => {
    debugLog("VideoFeed", "Manual retry triggered");
    fetchFeed(searchQuery, categoryFilter, userId);
  };

  // Debug panel
  const DebugPanel = () => {
    if (!showDebug) return null;
    
    return (
      <div className="fixed top-16 right-4 z-[100] bg-black/90 border border-white/20 rounded-lg p-3 text-xs text-white font-mono max-w-xs">
        <div className="flex items-center gap-2 mb-2 border-b border-white/20 pb-2">
          <Bug className="h-4 w-4" />
          <span>Debug Panel</span>
        </div>
        <div className="space-y-1">
          <div><span className="text-gray-400">debugId:</span> {debugId.slice(0, 8)}</div>
          <div><span className="text-gray-400">authStatus:</span> {authStatus}</div>
          <div><span className="text-gray-400">userId:</span> {userId?.slice(0, 8) || 'none'}</div>
          <div><span className="text-gray-400">loading:</span> {fetchState.loading ? 'yes' : 'no'}</div>
          <div><span className="text-gray-400">source:</span> {fetchState.source || '-'}</div>
          <div><span className="text-gray-400">attempts:</span> {fetchState.attemptCount}</div>
          <div><span className="text-gray-400">videos:</span> {fetchState.videoCount}</div>
          <div><span className="text-gray-400">duration:</span> {fetchState.duration ? `${fetchState.duration}ms` : '-'}</div>
          {fetchState.error && (
            <div className="text-red-400 break-all"><span className="text-gray-400">error:</span> {fetchState.error}</div>
          )}
          {fetchState.lastAttempt && (
            <div><span className="text-gray-400">lastAttempt:</span> {new Date(fetchState.lastAttempt).toLocaleTimeString()}</div>
          )}
        </div>
      </div>
    );
  };

  // Auth not ready yet - show waiting state
  if (authStatus !== "ready") {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Initializing...</p>
        <DebugPanel />
      </div>
    );
  }

  // Loading state
  if (fetchState.loading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
        <DebugPanel />
      </div>
    );
  }

  // Error state with retry
  if (fetchState.error) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-4">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-red-400 text-lg text-center">{fetchState.error}</p>
        <p className="text-muted-foreground text-sm">Attempts: {fetchState.attemptCount}</p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Try Again
        </button>
        <DebugPanel />
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
        <DebugPanel />
      </div>
    );
  }

  return (
    <>
      <DebugPanel />
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
            shouldPreload={Math.abs(index - activeIndex) <= 1}
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
    </>
  );
};
