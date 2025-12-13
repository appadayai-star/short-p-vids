import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage } from "@/lib/cloudinary";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const hasFetchedRef = useRef(false);

  // Fetch videos immediately on mount - don't wait for auth
  useEffect(() => {
    // Only fetch once
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchVideos = async () => {
      console.log("[VideoFeed] Starting fetch (no auth wait)...");
      
      try {
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);

        if (categoryFilter) {
          query = query.contains('tags', [categoryFilter]);
        }
        if (searchQuery) {
          query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
        }

        console.log("[VideoFeed] Executing query...");
        const result = await query;
        console.log("[VideoFeed] Query result:", result);
        
        const { data, error: queryError } = result;

        if (queryError) {
          console.error("[VideoFeed] Query error:", queryError);
          throw queryError;
        }

        let results = data || [];
        console.log("[VideoFeed] Got videos:", results.length);
        
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter(v =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        results.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(results);
        setHasMore(results.length === PAGE_SIZE);
        
        if (results.length > 1) {
          const thumb = getBestThumbnailUrl(results[1].cloudinary_public_id || null, results[1].thumbnail_url);
          preloadImage(thumb);
        }
      } catch (err) {
        console.error("[VideoFeed] Fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load videos");
        setVideos([]);
      } finally {
        setLoading(false);
        console.log("[VideoFeed] Fetch complete, loading=false");
      }
    };

    fetchVideos();
  }, []); // No dependencies - run once on mount

  // Re-fetch when filters change
  useEffect(() => {
    if (!hasFetchedRef.current) return; // Don't run on initial mount
    
    const refetch = async () => {
      setLoading(true);
      setActiveIndex(0);
      loadedIdsRef.current.clear();
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      try {
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, stream_url, 
            cloudinary_public_id, thumbnail_url, views_count, likes_count, tags, user_id,
            profiles(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);

        if (categoryFilter) {
          query = query.contains('tags', [categoryFilter]);
        }
        if (searchQuery) {
          query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
        }

        const { data, error: queryError } = await query;
        if (queryError) throw queryError;

        let results = data || [];
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter(v =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        results.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(results);
        setHasMore(results.length === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load videos");
      } finally {
        setLoading(false);
      }
    };

    refetch();
  }, [searchQuery, categoryFilter]);

  // Scroll handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;
    
    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const itemHeight = container.clientHeight;
        const newIndex = Math.floor((scrollTop + itemHeight * 0.4) / itemHeight);
        
        if (newIndex >= 0 && newIndex < videos.length && newIndex !== activeIndex) {
          setActiveIndex(newIndex);
        }
      }, 30);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [activeIndex, videos.length]);

  // Load more
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || videos.length === 0) return;
    if (activeIndex < videos.length - 3) return;

    const loadMore = async () => {
      setIsLoadingMore(true);
      try {
        const offset = videos.length;
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

        const newVideos = (data || []).filter(v => !loadedIdsRef.current.has(v.id));
        newVideos.forEach(v => loadedIdsRef.current.add(v.id));
        
        setVideos(prev => [...prev, ...newVideos]);
        setHasMore(newVideos.length > 0);
      } catch (err) {
        console.error("Load more error:", err);
      } finally {
        setIsLoadingMore(false);
      }
    };

    loadMore();
  }, [activeIndex, videos.length, hasMore, isLoadingMore, loading, searchQuery, categoryFilter]);

  const handleViewTracked = useCallback(async (videoId: string) => {
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch {}
  }, [userId]);

  const handleRetry = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-4">
        <p className="text-red-400 text-lg text-center">{error}</p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Try Again
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

  return (
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
  );
};
