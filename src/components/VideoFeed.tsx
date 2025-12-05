import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VideoPlayer } from "./VideoPlayer";
import { Loader2 } from "lucide-react";

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

  const fetchVideos = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Use recommendation algorithm for main feed (no search/category)
      if (!searchQuery && !categoryFilter) {
        const { data, error } = await supabase.functions.invoke('get-recommended-feed', {
          body: { userId, page: 0, limit: 20 }
        });

        if (error) throw error;
        
        if (data?.videos?.length > 0) {
          setVideos(data.videos);
          setIsLoading(false);
          return;
        }
        // Fall through to direct query if no results
      }

      // Direct query for search/category or as fallback
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

      setVideos(filtered);
    } catch (error) {
      console.error("Error fetching videos:", error);
      
      // Final fallback - simple query
      const { data } = await supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, thumbnail_url,
          views_count, likes_count, comments_count, tags, user_id,
          profiles(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .limit(20);
      
      setVideos(data || []);
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
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [currentIndex, videos.length]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-black">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <p className="text-primary text-lg">
          {searchQuery ? "No videos found" : categoryFilter ? `No videos in ${categoryFilter}` : "No videos yet"}
        </p>
      </div>
    );
  }

  return (
    <div id="video-feed-container" className="w-full h-screen snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scrollbar-hide">
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
        />
      ))}
    </div>
  );
};
