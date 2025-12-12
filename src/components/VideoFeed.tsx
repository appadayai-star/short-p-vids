import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { SinglePlayer } from "./SinglePlayer";
import { Loader2 } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestVideoSource } from "@/lib/cloudinary";

const PAGE_SIZE = 10;

// Minimal video data for first paint (no joins)
interface MinimalVideo {
  id: string;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  user_id: string;
}

// Full video data with profile
interface Video extends MinimalVideo {
  title: string;
  description: string | null;
  tags: string[] | null;
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

// Default profile for lazy loading
const DEFAULT_PROFILE = { username: "...", avatar_url: null };

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
  const profileCacheRef = useRef<Map<string, { username: string; avatar_url: string | null }>>(new Map());

  // Track container refs from FeedItems
  const handleContainerRef = useCallback((index: number, ref: HTMLDivElement | null) => {
    if (ref) {
      itemRefsRef.current.set(index, ref);
    } else {
      itemRefsRef.current.delete(index);
    }
  }, []);

  // Update active container rect when activeIndex changes
  useEffect(() => {
    const updateRect = () => {
      const activeContainer = itemRefsRef.current.get(activeIndex);
      if (activeContainer) {
        setActiveContainerRect(activeContainer.getBoundingClientRect());
      }
    };

    updateRect();
    
    const handleUpdate = () => {
      requestAnimationFrame(updateRect);
    };

    window.addEventListener('resize', handleUpdate);
    const container = containerRef.current;
    container?.addEventListener('scroll', handleUpdate);
    
    return () => {
      window.removeEventListener('resize', handleUpdate);
      container?.removeEventListener('scroll', handleUpdate);
    };
  }, [activeIndex, videos.length]);

  // Lazy-load profiles for visible videos
  const loadProfiles = useCallback(async (videoList: MinimalVideo[]) => {
    const userIds = [...new Set(videoList.map(v => v.user_id))].filter(
      id => !profileCacheRef.current.has(id)
    );
    
    if (userIds.length === 0) return;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", userIds);

    if (profiles) {
      profiles.forEach(p => {
        profileCacheRef.current.set(p.id, { username: p.username, avatar_url: p.avatar_url });
      });

      // Update videos with loaded profiles
      setVideos(prev => prev.map(v => ({
        ...v,
        profiles: profileCacheRef.current.get(v.user_id) || v.profiles
      })));
    }
  }, []);

  // Fetch videos with pagination
  const fetchVideos = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 0) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    
    try {
      const offset = pageNum * PAGE_SIZE;
      
      // For search/category, use direct query with full data
      if (searchQuery || categoryFilter) {
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
        return;
      }

      // For main feed - use minimal mode for first page
      const isFirstPage = pageNum === 0;
      
      try {
        const { data, error } = await supabase.functions.invoke('get-recommended-feed', {
          body: { userId, page: pageNum, limit: PAGE_SIZE, minimal: isFirstPage }
        });

        if (!error && data?.videos?.length > 0) {
          const newVideos = data.videos.filter((v: MinimalVideo) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: MinimalVideo) => loadedIdsRef.current.add(v.id));
          
          // For minimal mode, add default profiles and lazy-load real ones
          const videosWithProfiles: Video[] = newVideos.map((v: MinimalVideo) => ({
            ...v,
            title: "",
            description: null,
            tags: null,
            profiles: profileCacheRef.current.get(v.user_id) || DEFAULT_PROFILE
          }));

          setHasMore(data.videos.length === PAGE_SIZE);
          
          if (append) {
            setVideos(prev => [...prev, ...videosWithProfiles]);
          } else {
            loadedIdsRef.current.clear();
            newVideos.forEach((v: MinimalVideo) => loadedIdsRef.current.add(v.id));
            setVideos(videosWithProfiles);
          }

          // Lazy-load profiles after render
          if (isFirstPage && data.minimal) {
            setTimeout(() => loadProfiles(newVideos), 50);
            
            // Also fetch full data for metadata
            fetchFullVideoData(newVideos.map((v: MinimalVideo) => v.id));
          }
          return;
        }
      } catch (funcError) {
        console.log("Edge function failed, using fallback:", funcError);
      }

      // Fallback: direct database query
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, thumbnail_url,
          views_count, likes_count, tags, user_id,
          profiles(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (fallbackError) throw fallbackError;
      
      const newVideos = (fallbackData || []).filter(v => !loadedIdsRef.current.has(v.id));
      newVideos.forEach(v => loadedIdsRef.current.add(v.id));
      
      setHasMore((fallbackData?.length || 0) === PAGE_SIZE);
      
      if (append) {
        setVideos(prev => [...prev, ...newVideos]);
      } else {
        loadedIdsRef.current.clear();
        newVideos.forEach(v => loadedIdsRef.current.add(v.id));
        setVideos(newVideos);
      }
    } catch (error) {
      console.error("Error fetching videos:", error);
      if (!append) setVideos([]);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [searchQuery, categoryFilter, userId, loadProfiles]);

  // Fetch full video data (title, description, tags) after initial render
  const fetchFullVideoData = useCallback(async (videoIds: string[]) => {
    if (videoIds.length === 0) return;

    const { data } = await supabase
      .from("videos")
      .select("id, title, description, tags")
      .in("id", videoIds);

    if (data) {
      const dataMap = new Map(data.map(v => [v.id, v]));
      setVideos(prev => prev.map(v => {
        const full = dataMap.get(v.id);
        return full ? { ...v, title: full.title, description: full.description, tags: full.tags } : v;
      }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    setPage(0);
    setActiveIndex(0);
    loadedIdsRef.current.clear();
    setHasWarmedUp(false);
    fetchVideos(0, false);
  }, [searchQuery, categoryFilter, userId]);

  // Warmup: prime connection for first video URL
  useEffect(() => {
    if (hasWarmedUp || videos.length === 0) return;
    
    const firstVideo = videos[0];
    const videoUrl = getBestVideoSource(
      firstVideo.cloudinary_public_id || null,
      firstVideo.optimized_video_url || null,
      firstVideo.stream_url || null,
      firstVideo.video_url
    );
    
    fetch(videoUrl, { method: 'HEAD', mode: 'cors' })
      .then(() => {
        console.log('[VideoFeed] Warmed up first video connection');
        setHasWarmedUp(true);
      })
      .catch(() => {
        setHasWarmedUp(true);
      });
  }, [videos, hasWarmedUp]);

  // Preload next video metadata
  useEffect(() => {
    if (!hasEntered || videos.length === 0) return;
    
    const nextIndex = activeIndex + 1;
    if (nextIndex >= videos.length) return;
    
    const nextVideo = videos[nextIndex];
    const videoUrl = getBestVideoSource(
      nextVideo.cloudinary_public_id || null,
      nextVideo.optimized_video_url || null,
      nextVideo.stream_url || null,
      nextVideo.video_url
    );
    
    fetch(videoUrl, { method: 'HEAD', mode: 'cors' }).catch(() => {});
  }, [activeIndex, videos, hasEntered]);

  // Infinite scroll
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

  // Detect active video via scroll position
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

  // Track view callback
  const handleViewTracked = useCallback(async (videoId: string) => {
    try {
      await supabase.from("video_views").insert({
        video_id: videoId,
        user_id: userId,
      });
    } catch (error) {
      // Silent fail
    }
  }, [userId]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[100dvh] bg-black">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
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
      {searchQuery && (
        <div className="fixed top-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-sm p-3 pointer-events-none">
          <p className="text-sm text-primary text-center">
            Search: <span className="font-semibold">{searchQuery}</span>
          </p>
        </div>
      )}

      {/* Single shared video player */}
      <SinglePlayer
        video={activeVideo}
        containerRect={activeContainerRect}
        hasEntered={hasEntered}
        onViewTracked={handleViewTracked}
      />

      {/* Feed items (thumbnail-only) */}
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

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-20 w-full" />
      
      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};
