import { useState, useRef, useEffect } from "react";
import { Heart, Eye, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VideoCardProps {
  video: {
    id: string;
    title: string;
    description: string | null;
    video_url: string;
    views_count: number;
    likes_count: number;
    profiles: {
      username: string;
      avatar_url: string | null;
    };
  };
  currentUserId: string;
}

export const VideoCard = ({ video, currentUserId }: VideoCardProps) => {
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Check if user has liked this video
    const checkLikeStatus = async () => {
      const { data } = await supabase
        .from("likes")
        .select("id")
        .eq("video_id", video.id)
        .eq("user_id", currentUserId)
        .single();
      
      setIsLiked(!!data);
    };

    checkLikeStatus();
  }, [video.id, currentUserId]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasViewed) {
            // Track view
            trackView();
            setHasViewed(true);
          }
        });
      },
      { threshold: 0.5 }
    );

    if (videoRef.current) {
      observer.observe(videoRef.current);
    }

    return () => observer.disconnect();
  }, [hasViewed]);

  const trackView = async () => {
    try {
      await supabase.from("video_views").insert({
        video_id: video.id,
        user_id: currentUserId,
      });

      // Increment view count
      await supabase
        .from("videos")
        .update({ views_count: video.views_count + 1 })
        .eq("id", video.id);
    } catch (error) {
      console.error("Error tracking view:", error);
    }
  };

  const toggleLike = async () => {
    try {
      if (isLiked) {
        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("video_id", video.id)
          .eq("user_id", currentUserId);

        if (error) throw error;
        
        setIsLiked(false);
        setLikesCount((prev) => prev - 1);
      } else {
        const { error } = await supabase.from("likes").insert({
          video_id: video.id,
          user_id: currentUserId,
        });

        if (error) throw error;
        
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
      }
    } catch (error: any) {
      toast.error("Failed to update like");
      console.error("Error toggling like:", error);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="bg-card rounded-lg overflow-hidden border border-border">
      <div className="relative aspect-[9/16] bg-muted">
        <video
          ref={videoRef}
          src={video.video_url}
          className="w-full h-full object-contain"
          loop
          playsInline
          onClick={togglePlay}
        />
        {!isPlaying && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
          >
            <Play className="h-16 w-16 text-white fill-white" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-lg">{video.title}</h3>
          <p className="text-sm text-muted-foreground">@{video.profiles.username}</p>
        </div>

        {video.description && (
          <p className="text-sm text-foreground">{video.description}</p>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={toggleLike}
            className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
          >
            <Heart
              className={cn("h-5 w-5", isLiked && "fill-primary text-primary")}
            />
            <span>{likesCount}</span>
          </button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Eye className="h-5 w-5" />
            <span>{video.views_count}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
