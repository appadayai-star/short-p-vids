import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SimplePlayer } from "./SimplePlayer";
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
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const loadedIds = useRef<Set<string>>(new Set());
  const page = useRef(0);

  // Simple, direct fetch - no edge functions, no complexity
  const fetchVideos = useCallback(async (reset = true) => {
    console.log("[SimpleFeed] fetchVideos called, reset:", reset);
    
    if (reset) {
      setLoading(true);
      setError(null);
      setActiveIndex(0);
      page.current = 0;
      loadedIds.current.clear();
      if (containerRef.current) containerRef.current.scrollTop = 0;
    }

    try {
      console.log("[SimpleFeed] Starting Supabase query...");
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

      const { data, error: fetchError } = await query;

      if (fetchError) {
        console.error("[SimpleFeed] Query error:", fetchError);
        throw fetchError;
      }

      const fetchedVideos = data || [];
      console.log("[SimpleFeed] Fetched", fetchedVideos.length, "videos");
      fetchedVideos.forEach(v => loadedIds.current.add(v.id));
      setVideos(fetchedVideos);
      setHasMore(fetchedVideos.length === PAGE_SIZE);
    } catch (err) {
      console.error("[SimpleFeed] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load videos");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter]);

  // Initial load
  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Load more
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    page.current += 1;
    const offset = page.current * PAGE_SIZE;

    try {
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

      const { data } = await query;
      const newVideos = (data || []).filter(v => !loadedIds.current.has(v.id));
      newVideos.forEach(v => loadedIds.current.add(v.id));
      
      setVideos(prev => [...prev, ...newVideos]);
      setHasMore(newVideos.length > 0);
    } catch (err) {
      console.error("[SimpleFeed] Load more error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, searchQuery, categoryFilter]);

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
      
      // Load more when near bottom
      if (scrollTop + itemHeight * 2 >= container.scrollHeight && hasMore && !loadingMore) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeIndex, videos.length, hasMore, loadingMore, loadMore]);

  // Get active container rect
  const getActiveRect = useCallback(() => {
    const activeRef = itemRefs.current.get(activeIndex);
    return activeRef?.getBoundingClientRect() || null;
  }, [activeIndex]);

  const [activeRect, setActiveRect] = useState<DOMRect | null>(null);
  
  useEffect(() => {
    const updateRect = () => setActiveRect(getActiveRect());
    updateRect();
    
    const timer = setTimeout(updateRect, 100);
    window.addEventListener('resize', updateRect);
    containerRef.current?.addEventListener('scroll', updateRect);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateRect);
    };
  }, [activeIndex, videos.length, getActiveRect]);

  // Register item refs
  const handleRef = useCallback((index: number, ref: HTMLDivElement | null) => {
    if (ref) {
      itemRefs.current.set(index, ref);
    } else {
      itemRefs.current.delete(index);
    }
  }, []);

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
          onClick={() => fetchVideos()}
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

  const activeVideo = videos[activeIndex] || null;

  return (
    <div
      ref={containerRef}
      id="video-feed-container"
      className="w-full h-[100dvh] snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scrollbar-hide"
      style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Single shared video player */}
      <SimplePlayer
        video={activeVideo}
        containerRect={activeRect}
        hasEntered={hasEntered}
        onViewTracked={handleViewTracked}
      />
      
      {/* Feed items (thumbnails + UI) */}
      {videos.map((video, index) => (
        <FeedItem
          key={video.id}
          video={video}
          index={index}
          isActive={index === activeIndex}
          currentUserId={userId}
          onContainerRef={handleRef}
        />
      ))}
      
      {/* Loading more indicator */}
      {loadingMore && (
        <div className="flex justify-center py-4 bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
