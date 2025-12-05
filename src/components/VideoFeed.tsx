import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VideoCard } from "./VideoCard";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  thumbnail_url: string | null;
  processing_status?: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
  tags: string[] | null;
  created_at: string;
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
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchVideos = useCallback(async (pageNum: number, query: string, category: string, existingVideoIds: string[] = []) => {
    setIsLoading(true);
    try {
      if (query.trim()) {
        // Search mode - search by description, title, tags, and username
        const { data, error } = await supabase
          .from("videos")
          .select(`
            *,
            profiles!inner(username, avatar_url)
          `)
          .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
          .order("created_at", { ascending: false })
          .range(pageNum * 10, (pageNum + 1) * 10 - 1);

        if (error) throw error;
        
        // Filter by username or tags on the client side since we can't use .or() with joined tables
        const filtered = data?.filter(video => {
          const matchesUsername = video.profiles.username.toLowerCase().includes(query.toLowerCase());
          const matchesTags = video.tags?.some(tag => tag.toLowerCase().includes(query.toLowerCase()));
          const matchesTitle = video.title.toLowerCase().includes(query.toLowerCase());
          const matchesDescription = video.description?.toLowerCase().includes(query.toLowerCase());
          return matchesUsername || matchesTags || matchesTitle || matchesDescription;
        }) || [];
        
        if (pageNum === 0) {
          setVideos(filtered);
        } else {
          setVideos((prev) => [...prev, ...filtered]);
        }
        setHasMore((filtered.length || 0) === 10);
      } else if (category.trim()) {
        // Category filter mode - show only videos with that tag
        const { data, error } = await supabase
          .from("videos")
          .select(`
            *,
            profiles!inner(username, avatar_url)
          `)
          .contains('tags', [category])
          .order("created_at", { ascending: false })
          .range(pageNum * 10, (pageNum + 1) * 10 - 1);

        if (error) throw error;
        
        if (pageNum === 0) {
          setVideos(data || []);
        } else {
          setVideos((prev) => [...prev, ...(data || [])]);
        }
        setHasMore((data?.length || 0) === 10);
      } else if (userId) {
        // For You feed - fetch directly from database for better performance
        // Show all videos, sorted by engagement and recency
        const { data, error } = await supabase
          .from("videos")
          .select(`
            *,
            profiles!inner(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(pageNum * 10, (pageNum + 1) * 10 - 1);

        if (error) throw error;
        
        if (pageNum === 0) {
          setVideos(data || []);
        } else {
          setVideos((prev) => [...prev, ...(data || [])]);
        }
        setHasMore((data?.length || 0) === 10);
      } else {
        // Not logged in - show all recent videos
        const { data, error } = await supabase
          .from("videos")
          .select(`
            *,
            profiles!inner(username, avatar_url)
          `)
          .order("created_at", { ascending: false })
          .range(pageNum * 10, (pageNum + 1) * 10 - 1);

        if (error) throw error;
        
        if (pageNum === 0) {
          setVideos(data || []);
        } else {
          setVideos((prev) => [...prev, ...(data || [])]);
        }
        setHasMore((data?.length || 0) === 10);
      }
    } catch (error: any) {
      toast.error("Failed to load videos");
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    setVideos([]);
    fetchVideos(0, searchQuery, categoryFilter, []);
  }, [searchQuery, categoryFilter, userId]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = document.documentElement.scrollTop;
      const clientHeight = document.documentElement.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoading && hasMore) {
        setPage(prev => {
          const nextPage = prev + 1;
          fetchVideos(nextPage, searchQuery, categoryFilter, videos.map(v => v.id));
          return nextPage;
        });
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoading, hasMore, searchQuery, categoryFilter, videos, userId]);

  return (
    <div className="w-full h-screen snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scroll-smooth scrollbar-hide">
      {searchQuery && (
        <div className="absolute top-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-sm p-3">
          <p className="text-sm text-primary text-center">
            Search results for: <span className="font-semibold">{searchQuery}</span>
          </p>
        </div>
      )}

      {videos.map((video) => (
        <VideoCard key={video.id} video={video} currentUserId={userId} />
      ))}

      {isLoading && (
        <div className="flex justify-center items-center h-screen bg-black">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <div className="flex items-center justify-center h-screen bg-black">
          <div className="text-center">
            <p className="text-primary text-lg">
              {searchQuery 
                ? "No videos found" 
                : categoryFilter 
                ? `No videos found in ${categoryFilter} category` 
                : "No videos yet. Be the first to upload!"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
