import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VideoPlayer } from "./VideoPlayer";
import { Loader2 } from "lucide-react";

// Preload videos ahead for instant playback
const PRELOAD_COUNT = 4;

// Aggressively preload video URLs
const preloadVideo = (url: string, priority: 'high' | 'low' = 'low') => {
  // Check if already preloading
  const existingLink = document.querySelector(`link[href="${url}"]`);
  if (existingLink) return;
  
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = url;
  // @ts-ignore - fetchpriority is valid but not in types
  link.fetchPriority = priority;
  document.head.appendChild(link);
  
  // Also create a hidden video element to start buffering
  if (priority === 'high') {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    video.style.display = 'none';
    document.body.appendChild(video);
    // Remove after buffering starts
    setTimeout(() => video.remove(), 5000);
  }
};

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
  const [currentIndex, setCurrentIndex] = useState(0);
  const preloadedRef = useRef<Set<string>>(new Set());

  const fetchVideos = useCallback(async () => {
    setIsLoading(true);
    
    try {
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
          .limit(20);

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

        // Immediately preload first video with high priority
        if (filtered.length > 0) {
          const firstUrl = filtered[0].optimized_video_url || filtered[0].video_url;
          preloadVideo(firstUrl, 'high');
        }

        setVideos(filtered);
        setIsLoading(false);
        return;
      }

      // For main feed, try recommendation algorithm
      try {
        const { data, error } = await supabase.functions.invoke('get-recommended-feed', {
          body: { userId, page: 0, limit: 20 }
        });

        if (!error && data?.videos?.length > 0) {
          // Immediately preload first video with high priority
          const firstUrl = data.videos[0].optimized_video_url || data.videos[0].video_url;
          preloadVideo(firstUrl, 'high');
          
          // Preload next few with lower priority
          for (let i = 1; i <= 3 && i < data.videos.length; i++) {
            const url = data.videos[i].optimized_video_url || data.videos[i].video_url;
            preloadVideo(url, 'low');
          }
          
          setVideos(data.videos);
          setIsLoading(false);
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
        .limit(20);

      if (fallbackError) throw fallbackError;
      
      // Immediately preload first video
      if (fallbackData && fallbackData.length > 0) {
        const firstUrl = fallbackData[0].optimized_video_url || fallbackData[0].video_url;
        preloadVideo(firstUrl, 'high');
      }
      
      setVideos(fallbackData || []);
    } catch (error) {
      console.error("Error fetching videos:", error);
      setVideos([]);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, categoryFilter, userId]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Track scroll position
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const container = e.target as HTMLElement;
      const scrollTop = container.scrollTop;
      const videoHeight = window.innerHeight;
      const newIndex = Math.round(scrollTop / videoHeight);
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < videos.length) {
        setCurrentIndex(newIndex);
      }
    };

    const container = document.getElementById('video-feed-container');
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [currentIndex, videos.length]);

  // Preload upcoming videos when scroll position changes
  useEffect(() => {
    if (videos.length === 0) return;
    
    // Preload next PRELOAD_COUNT videos
    for (let i = 1; i <= PRELOAD_COUNT; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex < videos.length) {
        const nextVideo = videos[nextIndex];
        const videoUrl = nextVideo.optimized_video_url || nextVideo.video_url;
        
        if (!preloadedRef.current.has(videoUrl)) {
          preloadedRef.current.add(videoUrl);
          preloadVideo(videoUrl, i === 1 ? 'high' : 'low');
        }
      }
    }
  }, [currentIndex, videos]);

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
    <div id="video-feed-container" className="w-full h-[100dvh] snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scrollbar-hide pb-16" style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}>
      {searchQuery && (
        <div className="fixed top-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-sm p-3 pointer-events-none">
          <p className="text-sm text-primary text-center">
            Search: <span className="font-semibold">{searchQuery}</span>
          </p>
        </div>
      )}

      {videos.map((video, index) => (
        <VideoPlayer 
          key={video.id} 
          video={video} 
          currentUserId={userId}
          isActive={index === currentIndex}
          shouldPreload={index >= currentIndex && index <= currentIndex + PRELOAD_COUNT}
          isFirstVideo={index === 0}
        />
      ))}
    </div>
  );
};
