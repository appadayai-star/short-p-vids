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
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
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
  userId: string;
}

export const VideoFeed = ({ searchQuery, userId }: VideoFeedProps) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchVideos = useCallback(async (pageNum: number, query: string) => {
    setIsLoading(true);
    try {
      if (query.trim()) {
        // Search mode
        const { data, error } = await supabase
          .from("videos")
          .select(`
            *,
            profiles!inner(username, avatar_url)
          `)
          .or(`title.ilike.%${query}%,tags.cs.{${query}},profiles.username.ilike.%${query}%`)
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
        // For You feed - call recommendation function
        const { data, error } = await supabase.functions.invoke("get-for-you-feed", {
          body: { userId, page: pageNum, limit: 10 },
        });

        if (error) throw error;

        if (pageNum === 0) {
          setVideos(data.videos || []);
        } else {
          setVideos((prev) => [...prev, ...(data.videos || [])]);
        }
        setHasMore((data.videos?.length || 0) === 10);
      }
    } catch (error: any) {
      toast.error("Failed to load videos");
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setPage(0);
    setVideos([]);
    fetchVideos(0, searchQuery);
  }, [searchQuery, fetchVideos]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = document.documentElement.scrollTop;
      const clientHeight = document.documentElement.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoading && hasMore) {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchVideos(nextPage, searchQuery);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [page, isLoading, hasMore, searchQuery, fetchVideos]);

  return (
    <div className="w-full h-screen snap-y snap-mandatory overflow-y-scroll overflow-x-hidden scroll-smooth">
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
              {searchQuery ? "No videos found" : "No videos yet. Be the first to upload!"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
