import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VideoCard } from "./VideoCard";
import { Loader2 } from "lucide-react";

const PAGE_SIZE = 10;
const PRELOAD_AHEAD = 2; // Number of videos to preload ahead

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
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
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch videos with pagination
  const fetchVideos = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 0) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    
    try {
      const offset = pageNum * PAGE_SIZE;
      
      // For search/category, use direct query
      if (searchQuery || categoryFilter) {
        let query = supabase
          .from("videos")
          .select(`
            id, title, description, video_url, optimized_video_url, thumbnail_url,
            views_count, likes_count, comments_count, tags, user_id,
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
        
        // Additional client-side filtering for search
        if (searchQuery && data) {
          const q = searchQuery.toLowerCase();
          filtered = data.filter(v => 
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        // Filter out already loaded videos
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

      // For main feed, try recommendation algorithm
      try {
        const { data, error } = await supabase.functions.invoke('get-recommended-feed', {
          body: { userId, page: pageNum, limit: PAGE_SIZE }
        });

        if (!error && data?.videos?.length > 0) {
          const newVideos = data.videos.filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          
          setHasMore(data.videos.length === PAGE_SIZE);
          
          if (append) {
            setVideos(prev => [...prev, ...newVideos]);
          } else {
            loadedIdsRef.current.clear();
            newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
            setVideos(newVideos);
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
          id, title, description, video_url, optimized_video_url, thumbnail_url,
          views_count, likes_count, comments_count, tags, user_id,
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
  }, [searchQuery, categoryFilter, userId]);

  // Initial load
  useEffect(() => {
    setPage(0);
    loadedIdsRef.current.clear();
    fetchVideos(0, false);
  }, [fetchVideos]);

  // Infinite scroll - observe sentinel element
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

  // Handle active video changes from VideoCard
  const handleActiveChange = useCallback((index: number, isActive: boolean) => {
    if (isActive) {
      setActiveIndex(index);
    }
  }, []);

  // Determine which videos should preload (current + next few)
  const shouldPreload = useCallback((index: number) => {
    return index >= activeIndex && index <= activeIndex + PRELOAD_AHEAD;
  }, [activeIndex]);

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

      {videos.map((video, index) => (
        <VideoCard 
          key={video.id} 
          video={video} 
          index={index}
          currentUserId={userId}
          shouldPreload={shouldPreload(index)}
          isFirstVideo={index === 0}
          onActiveChange={handleActiveChange}
        />
      ))}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />
      
      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};
