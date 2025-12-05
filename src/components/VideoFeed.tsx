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

  const fetchVideos = useCallback(async (pageNum: number, query: string, category: string) => {
    console.log("Fetching videos - page:", pageNum, "query:", query, "category:", category);
    setIsLoading(true);
    try {
      let supabaseQuery = supabase
        .from("videos")
        .select(`
          *,
          profiles!inner(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .range(pageNum * 10, (pageNum + 1) * 10 - 1);

      // Apply search filter
      if (query.trim()) {
        supabaseQuery = supabaseQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
      }
      
      // Apply category filter
      if (category.trim()) {
        supabaseQuery = supabaseQuery.contains('tags', [category]);
      }

      const { data, error } = await supabaseQuery;

      if (error) {
        console.error("Supabase error:", error);
        throw error;
      }

      console.log("Fetched videos:", data?.length || 0);

      // For search, do additional client-side filtering
      let finalData = data || [];
      if (query.trim() && data) {
        finalData = data.filter(video => {
          const matchesUsername = video.profiles.username.toLowerCase().includes(query.toLowerCase());
          const matchesTags = video.tags?.some((tag: string) => tag.toLowerCase().includes(query.toLowerCase()));
          const matchesTitle = video.title.toLowerCase().includes(query.toLowerCase());
          const matchesDescription = video.description?.toLowerCase().includes(query.toLowerCase());
          return matchesUsername || matchesTags || matchesTitle || matchesDescription;
        });
      }

      if (pageNum === 0) {
        setVideos(finalData);
      } else {
        setVideos((prev) => [...prev, ...finalData]);
      }
      setHasMore(finalData.length === 10);
    } catch (error: any) {
      toast.error("Failed to load videos");
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch videos on mount and when filters change
  useEffect(() => {
    console.log("Triggering initial fetch");
    setPage(0);
    setVideos([]);
    fetchVideos(0, searchQuery, categoryFilter);
  }, [searchQuery, categoryFilter, fetchVideos]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = document.documentElement.scrollTop;
      const clientHeight = document.documentElement.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoading && hasMore) {
        setPage(prev => {
          const nextPage = prev + 1;
          fetchVideos(nextPage, searchQuery, categoryFilter);
          return nextPage;
        });
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoading, hasMore, searchQuery, categoryFilter, fetchVideos]);

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
