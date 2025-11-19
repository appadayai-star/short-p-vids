import { useState, useRef, useEffect } from "react";
import { Heart, MessageCircle, Share2, Pause, Play } from "lucide-react";
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
    tags: string[] | null;
    profiles: {
      username: string;
      avatar_url: string | null;
    };
  };
  currentUserId: string | null;
}

export const VideoCard = ({ video, currentUserId }: VideoCardProps) => {
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);
  const [showPauseIcon, setShowPauseIcon] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkLikeStatus = async () => {
      if (!currentUserId) return;
      
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
          if (entry.isIntersecting) {
            if (!hasViewed) {
              trackView();
              setHasViewed(true);
            }
            // Autoplay when in view
            if (videoRef.current) {
              videoRef.current.play();
              setIsPlaying(true);
            }
          } else {
            // Pause when out of view
            if (videoRef.current) {
              videoRef.current.pause();
              setIsPlaying(false);
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [hasViewed]);

  const trackView = async () => {
    try {
      await supabase.from("video_views").insert({
        video_id: video.id,
        user_id: currentUserId,
      });

      await supabase
        .from("videos")
        .update({ views_count: video.views_count + 1 })
        .eq("id", video.id);
    } catch (error) {
      console.error("Error tracking view:", error);
    }
  };

  const toggleLike = async () => {
    if (!currentUserId) {
      toast.error("Please login to like videos");
      return;
    }

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
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
      setShowPauseIcon(true);
      setTimeout(() => setShowPauseIcon(false), 500);
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: video.title,
        text: `Check out this video by @${video.profiles.username}`,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard!");
    }
  };

  const handleComment = () => {
    toast.info("Comments feature coming soon!");
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen snap-start snap-always bg-black overflow-hidden"
    >
      <video
        ref={videoRef}
        src={video.video_url}
        className="absolute inset-0 w-full h-full object-cover"
        loop
        playsInline
        onClick={togglePlay}
      />

      {/* Pause/Play overlay indicator */}
      {showPauseIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isPlaying ? (
              <Play className="h-12 w-12 text-white fill-white" />
            ) : (
              <Pause className="h-12 w-12 text-white fill-white" />
            )}
          </div>
        </div>
      )}

      {/* Right side actions (TikTok style) */}
      <div className="absolute right-4 bottom-24 flex flex-col gap-6 z-10">
        <button
          onClick={toggleLike}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart
              className={cn(
                "h-7 w-7",
                isLiked ? "fill-primary text-primary" : "text-white"
              )}
            />
          </div>
          <span className="text-white text-xs font-semibold">{likesCount}</span>
        </button>

        <button
          onClick={handleComment}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <MessageCircle className="h-7 w-7 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">0</span>
        </button>

        <button
          onClick={handleShare}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Share2 className="h-7 w-7 text-white" />
          </div>
        </button>
      </div>

      {/* Bottom info - positioned to leave space for action buttons */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-20 z-10 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" style={{ paddingRight: '80px' }}>
        <div className="space-y-2 pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border-2 border-primary">
              {video.profiles.avatar_url ? (
                <img
                  src={video.profiles.avatar_url}
                  alt={video.profiles.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                  {video.profiles.username[0].toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-white font-semibold">@{video.profiles.username}</span>
          </div>

          <h3 className="text-white font-semibold text-lg">{video.title}</h3>
          
          {video.description && (
            <p className="text-white/90 text-sm line-clamp-2">{video.description}</p>
          )}

          {video.tags && video.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {video.tags.map((tag, idx) => (
                <span key={idx} className="text-primary text-sm font-semibold">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
