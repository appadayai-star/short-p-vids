import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VideoCard } from "@/components/VideoCard";
import { SEO, generateVideoSEO } from "@/components/SEO";
import { X } from "lucide-react";
import { toast } from "sonner";

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
  user_id: string;
  tags: string[] | null;
  created_at?: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

const Video = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUserId(session?.user?.id || null);
    };
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (videoId) {
      fetchVideo();
    }
  }, [videoId]);

  const fetchVideo = async () => {
    if (!videoId) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, thumbnail_url,
          views_count, likes_count, comments_count, user_id, tags, created_at,
          profiles(username, avatar_url)
        `)
        .eq("id", videoId)
        .single();

      if (error) throw error;
      setVideo(data);
    } catch (error) {
      console.error("Error fetching video:", error);
      toast.error("Failed to load video");
      navigate("/");
    } finally {
      setIsLoading(false);
    }
  };

  // Generate SEO props using the helper
  const seoProps = video ? generateVideoSEO({
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnail_url: video.thumbnail_url,
    video_url: video.optimized_video_url || video.video_url,
    created_at: video.created_at,
    views_count: video.views_count,
    tags: video.tags,
    profiles: video.profiles,
  }) : {};

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <SEO {...seoProps} />
      
      <button
        onClick={() => navigate(-1)}
        className="fixed top-4 left-4 z-50 p-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {isLoading ? (
        <div className="flex items-center justify-center h-screen">
          <div className="text-primary text-lg">Loading...</div>
        </div>
      ) : video ? (
        <div className="h-screen overflow-y-auto">
          <VideoCard 
            video={video} 
            index={0}
            currentUserId={currentUserId}
            shouldPreload={true}
            isFirstVideo={true}
            onActiveChange={() => {}}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-screen">
          <div className="text-white text-lg">Video not found</div>
        </div>
      )}
    </div>
  );
};

export default Video;
