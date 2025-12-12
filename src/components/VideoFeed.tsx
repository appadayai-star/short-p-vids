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
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleContainerRef = useCallback((index: number, ref: HTMLDivElement | null) => {
    if (ref) {
      itemRefsRef.current.set(index, ref);
    } else {
      itemRefsRef.current.delete(index);
    }
  }, []);

  useEffect(() => {
    const updateRect = () => {
      const activeContainer = itemRefsRef.current.get(activeIndex);
      if (activeContainer) {
        setActiveContainerRect(activeContainer.getBoundingClientRect());
      }
    };
    updateRect();
    const handleUpdate = () => requestAnimationFrame(updateRect);
    window.addEventListener('resize', handleUpdate);
    const container = containerRef.current;
    container?.addEventListener('scroll', handleUpdate);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      container?.removeEventListener('scroll', handleUpdate);
    };
  }, [activeIndex, videos.length]);

  const fetchVideos = useCallback(async (pageNum: number, append = false) => {
    console.log(`[VideoFeed] fetchVideos: page=${pageNum}`);
    
    if (pageNum === 0) {
      setIsLoading(true);
      setLoadError(null);
    } else {
      setIsLoadingMore(true);
    }
    
    try {
      const offset = pageNum * PAGE_SIZE;
      
      // Direct database query - simple and reliable
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

      let filtered = data || [];
      
      if (searchQuery && data) {
        const q = searchQuery.toLowerCase();
        filtered = data.filter(v => 
          v.title?.toLowerCase().includes(q) ||
          v.description?.toLowerCase().includes(q) ||
          v.profiles?.username?.toLowerCase().includes(q) ||
          v.tags?.some(t => t.toLowerCase().includes(q))
        );
      }

      const newVideos = filtered.filter(v => !loadedIdsRef.current.has(v.id));
      newVideos.forEach(v => loadedIdsRef.current.add(v.id));

      setHasMore(data?.length === PAGE_SIZE);
      
      if (append) {
        setVideos(prev => [...prev, ...newVideos]);
      } else {
        loadedIdsRef.current.clear();
        newVideos.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(newVideos);
      }
    } catch (error) {
      console.error("[VideoFeed] Error:", error);
      if (!append) {
        setVideos([]);
        setLoadError(error instanceof Error ? error.message : "Failed to load videos");
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    console.log("[VideoFeed] Initial load");
    setPage(0);
    setActiveIndex(0);
    loadedIdsRef.current.clear();
    setHasWarmedUp(false);
    fetchVideos(0, false);
  }, [searchQuery, categoryFilter, userId]);

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

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchVideos(nextPage, true);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, page, fetchVideos]);

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
    setLoadError(null);
    fetchVideos(0, false);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[100dvh] bg-black">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4">
        <p className="text-red-400 text-lg">{loadError}</p>
        <button onClick={handleRetry} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg">
          <RefreshCw className="h-5 w-5" /> Retry
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
