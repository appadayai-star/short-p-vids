import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage } from "@/lib/cloudinary";

const PAGE_SIZE = 10;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

  // Fetch videos using raw fetch to bypass Supabase client issues
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchVideos = async () => {
      console.log("[VideoFeed] Starting fetch with raw fetch...");
      
      try {
        // Build the query URL
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
        
        if (categoryFilter) {
          url += `&tags=cs.{${categoryFilter}}`;
        }
        if (searchQuery) {
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
        }

        console.log("[VideoFeed] Fetching from:", url);
        
        const response = await fetch(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        console.log("[VideoFeed] Response status:", response.status);

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        console.log("[VideoFeed] Got data:", data?.length);

        let results = data || [];
        
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
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
        console.log("[VideoFeed] Fetch complete");
      }
    };

    fetchVideos();
  }, []);

  // Re-fetch when filters change (using Supabase client for subsequent fetches)
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    if (!searchQuery && !categoryFilter) return; // Skip if no filters
    
    const refetch = async () => {
      setLoading(true);
      setActiveIndex(0);
      loadedIdsRef.current.clear();
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      try {
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
        
        if (categoryFilter) {
          url += `&tags=cs.{${categoryFilter}}`;
        }
        if (searchQuery) {
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
        }

        const response = await fetch(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

        const data = await response.json();
        let results = data || [];
        
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
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
        
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE}`;
        
        if (categoryFilter) url += `&tags=cs.{${categoryFilter}}`;
        if (searchQuery) url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;

        const response = await fetch(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

        const data = await response.json();
        const newVideos = (data || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
        newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
        
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
