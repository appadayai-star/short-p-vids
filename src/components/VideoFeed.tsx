import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestVideoSource } from "@/lib/cloudinary";

const PAGE_SIZE = 10;
const WHEEL_LOCK_MS = 550; // Increased lock time
const WHEEL_DELTA_THRESHOLD = 50; // Higher threshold to prevent accidental triggers
const SCROLL_SETTLE_MS = 150;
const TRANSITION_DURATION = 420;

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

// Detect desktop (fine pointer) vs mobile
const isDesktopPointer = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia("(pointer: fine)").matches;
};

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [isDesktop, setIsDesktop] = useState(isDesktopPointer());
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  
  // Scroll control refs - using refs to avoid useEffect re-registrations
  const activeIndexRef = useRef(0);
  const wheelLockRef = useRef(false);
  const wheelDeltaAccumRef = useRef(0);
  const scrollSettleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const videosLengthRef = useRef(0);
  const isDesktopRef = useRef(isDesktopPointer());

  // Keep refs in sync
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    videosLengthRef.current = videos.length;
  }, [videos.length]);

  // Update desktop detection on resize/orientation change
  useEffect(() => {
    const updatePointer = () => {
      const newIsDesktop = isDesktopPointer();
      setIsDesktop(newIsDesktop);
      isDesktopRef.current = newIsDesktop;
    };
    window.addEventListener('resize', updatePointer);
    return () => window.removeEventListener('resize', updatePointer);
  }, []);

  // Navigate to specific index - uses refs only
  const goToIndex = useCallback((index: number) => {
    const maxIndex = videosLengthRef.current - 1;
    const clampedIndex = Math.max(0, Math.min(index, maxIndex));
    
    if (clampedIndex === activeIndexRef.current || maxIndex < 0) return;
    
    setActiveIndex(clampedIndex);
    activeIndexRef.current = clampedIndex;
  }, []);

  // Desktop: wheel handler - registered ONCE, uses refs for all values
  useEffect(() => {
    // Only register on desktop - but check ref, not state to avoid re-registrations
    if (!isDesktopRef.current) return;

    const handleWheel = (e: WheelEvent) => {
      // Don't handle if no videos loaded yet
      if (videosLengthRef.current === 0) return;
      
      e.preventDefault();
      
      // If locked, completely ignore all wheel events
      if (wheelLockRef.current) return;
      
      // Accumulate delta
      wheelDeltaAccumRef.current += e.deltaY;
      
      // Only trigger when threshold reached
      if (Math.abs(wheelDeltaAccumRef.current) >= WHEEL_DELTA_THRESHOLD) {
        const direction = wheelDeltaAccumRef.current > 0 ? 1 : -1;
        const currentIdx = activeIndexRef.current;
        const maxIdx = videosLengthRef.current - 1;
        const targetIndex = Math.max(0, Math.min(currentIdx + direction, maxIdx));
        
        // Reset accumulator and lock IMMEDIATELY
        wheelDeltaAccumRef.current = 0;
        wheelLockRef.current = true;
        
        // Only navigate if actually changing
        if (targetIndex !== currentIdx) {
          setActiveIndex(targetIndex);
          activeIndexRef.current = targetIndex;
        }
        
        // Release lock after transition completes
        setTimeout(() => {
          wheelLockRef.current = false;
        }, WHEEL_LOCK_MS);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []); // Empty deps - register ONCE on mount

  // Mobile only: scroll-settle detection
  useEffect(() => {
    if (isDesktop) return;
    
    const container = containerRef.current;
    if (!container || videos.length === 0) return;

    const handleScroll = () => {
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
      
      scrollSettleTimerRef.current = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const itemHeight = container.clientHeight;
        const newIndex = Math.round(scrollTop / itemHeight);
        
        if (newIndex !== activeIndexRef.current && newIndex >= 0 && newIndex < videosLengthRef.current) {
          setActiveIndex(newIndex);
          activeIndexRef.current = newIndex;
        }
      }, SCROLL_SETTLE_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, [isDesktop, videos.length]);

  // Fetch videos
  const fetchVideos = useCallback(async (currentSearchQuery: string, currentCategoryFilter: string, currentUserId: string | null) => {
    console.log(`[VideoFeed] Fetching videos...`);
    setIsLoading(true);
    setLoadError(null);
    setActiveIndex(0);
    activeIndexRef.current = 0;
    setPage(0);
    loadedIdsRef.current.clear();
    
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }

    try {
      const isForYouFeed = !currentSearchQuery && !currentCategoryFilter;
      let fetchedVideos: Video[] = [];

      if (isForYouFeed) {
        console.log('[VideoFeed] Using edge function for personalized feed');
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: currentUserId, page: 0, limit: PAGE_SIZE }
        });
        
        if (error) throw new Error(error.message || "Failed to load feed");
        fetchedVideos = data?.videos || [];
        console.log(`[VideoFeed] Edge function returned ${fetchedVideos.length} videos`);
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
  }, []);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchVideos(searchQuery, categoryFilter, userId);
  }, [searchQuery, categoryFilter, fetchVideos]);

  // Load more videos (for mobile infinite scroll)
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

  // Desktop: load more when approaching end
  useEffect(() => {
    if (!isDesktop || !hasMore || isLoadingMore || isLoading) return;
    
    // Load more when 3 videos from end
    if (activeIndex >= videos.length - 3 && videos.length > 0) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadMoreVideos(nextPage);
    }
  }, [isDesktop, activeIndex, videos.length, hasMore, isLoadingMore, isLoading, page, loadMoreVideos]);

  // Mobile: Infinite scroll observer
  useEffect(() => {
    if (isDesktop) return;
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
  }, [isDesktop, hasMore, isLoadingMore, isLoading, page, loadMoreVideos]);

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

  const activeVideo = videos[activeIndex] || null;

  // Desktop: transform-based navigation (no scroll)
  if (isDesktop) {
    return (
      <>
        {/* Fixed fullscreen video player */}
        <SinglePlayer
          video={activeVideo}
          hasEntered={hasEntered}
          onViewTracked={handleViewTracked}
        />
        
        {/* Feed container - overflow hidden, no scroll */}
        <div
          ref={containerRef}
          id="video-feed-container"
          className="relative z-20 w-full h-[100dvh] overflow-hidden"
        >
          {/* Feed track - moves via transform with hardware acceleration */}
          <div
            className="w-full will-change-transform"
            style={{
              transform: `translate3d(0, -${activeIndex * 100}dvh, 0)`,
              transition: `transform ${TRANSITION_DURATION}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {videos.map((video, index) => (
              <FeedItem
                key={video.id}
                video={video}
                index={index}
                isActive={index === activeIndex}
                currentUserId={userId}
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  // Mobile: native scroll + snap
  return (
    <>
      {/* Fixed fullscreen video player */}
      <SinglePlayer
        video={activeVideo}
        hasEntered={hasEntered}
        onViewTracked={handleViewTracked}
      />
      
      {/* Scrollable feed - native scroll with snap */}
      <div
        ref={containerRef}
        id="video-feed-container"
        className="relative z-20 w-full h-[100dvh] overflow-y-scroll overflow-x-hidden scrollbar-hide"
        style={{ 
          outline: '5px solid blue',
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
            currentUserId={userId}
            isMobile
          />
        ))}
        <div ref={sentinelRef} className="h-px w-full" />
        {isLoadingMore && (
          <div className="flex justify-center py-4 bg-black">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>
    </>
  );
};
