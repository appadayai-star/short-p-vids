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

  const loadMore = () => {
    if (!isLoading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchVideos(nextPage, searchQuery);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto py-4 px-4">
      {searchQuery && (
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            Search results for: <span className="font-semibold text-foreground">{searchQuery}</span>
          </p>
        </div>
      )}

      <div className="space-y-6">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} currentUserId={userId} />
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery ? "No videos found" : "No videos yet. Be the first to upload!"}
          </p>
        </div>
      )}

      {!isLoading && hasMore && videos.length > 0 && (
        <div className="flex justify-center py-8">
          <button
            onClick={loadMore}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-full hover:opacity-90 transition-opacity"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
};
