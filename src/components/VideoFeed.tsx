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
      let query = supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, thumbnail_url,
          views_count, likes_count, comments_count, tags, user_id,
          profiles(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      // Apply category filter
      if (categoryFilter) {
        query = query.contains('tags', [categoryFilter]);
      }

      // Apply search filter
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Additional client-side filtering for search
      let filteredData = data || [];
      if (searchQuery && data) {
        const lowerQuery = searchQuery.toLowerCase();
        filteredData = data.filter(video => {
          const matchesTitle = video.title?.toLowerCase().includes(lowerQuery);
          const matchesDesc = video.description?.toLowerCase().includes(lowerQuery);
          const matchesUsername = video.profiles?.username?.toLowerCase().includes(lowerQuery);
          const matchesTags = video.tags?.some(tag => tag.toLowerCase().includes(lowerQuery));
          return matchesTitle || matchesDesc || matchesUsername || matchesTags;
        });
      }

      setVideos(filteredData);
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Track scroll position to determine current video
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
        <div className="text-center">
          <p className="text-primary text-lg">
            {searchQuery 
              ? "No videos found" 
              : categoryFilter 
              ? `No videos in ${categoryFilter}` 
              : "No videos yet"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      id="video-feed-container"
      className="w-full h-screen snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scrollbar-hide"
    >
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
