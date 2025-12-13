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
  const fetchVideos = useCallback(async (currentSearchQuery: string, currentCategoryFilter: string, currentUserId: string | null) => {
    console.log(`[VideoFeed] Fetching videos...`);
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
      const isForYouFeed = !currentSearchQuery && !currentCategoryFilter;
      let fetchedVideos: Video[] = [];

      if (isForYouFeed) {
        // Use edge function for personalized feed
        console.log('[VideoFeed] Using edge function for personalized feed');
        const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
          body: { userId: currentUserId, page: 0, limit: PAGE_SIZE }
        });
        
        if (error) throw new Error(error.message || "Failed to load feed");
        fetchedVideos = data?.videos || [];
        console.log(`[VideoFeed] Edge function returned ${fetchedVideos.length} videos`);
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

        if (currentCategoryFilter) {
          query = query.contains('tags', [currentCategoryFilter]);
        }
        if (currentSearchQuery) {
          query = query.or(`title.ilike.%${currentSearchQuery}%,description.ilike.%${currentSearchQuery}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        fetchedVideos = data || [];

        // Client-side search filtering
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
