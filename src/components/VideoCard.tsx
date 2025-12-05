import { useState, useRef, useEffect } from "react";
import { Heart, MessageCircle, Share2, Pause, Play, Bookmark, MoreVertical, Trash2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CommentsDrawer } from "./CommentsDrawer";
import { ShareDrawer } from "./ShareDrawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface VideoCardProps {
  video: {
    id: string;
    title: string;
    description: string | null;
    video_url: string;
    optimized_video_url?: string | null;
    thumbnail_url?: string | null;
    processing_status?: string | null;
    views_count: number;
    likes_count: number;
    comments_count: number;
    user_id: string;
    tags: string[] | null;
    profiles: {
      username: string;
      avatar_url: string | null;
    };
  };
  currentUserId: string | null;
  onDelete?: (videoId: string) => void;
  onNavigate?: () => void;
}

export const VideoCard = ({ video, currentUserId, onDelete, onNavigate }: VideoCardProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [commentsCount, setCommentsCount] = useState(video.comments_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);
  const [showPauseIcon, setShowPauseIcon] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInViewRef = useRef(false);

  // Timeout to hide loading spinner after 2 seconds max
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVideoReady(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, []);

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

    const checkSavedStatus = async () => {
      if (!currentUserId) return;
      
      const { data } = await supabase
        .from("saved_videos")
        .select("id")
        .eq("video_id", video.id)
        .eq("user_id", currentUserId)
        .single();
      
      setIsSaved(!!data);
    };

    const fetchSavesCount = async () => {
      const { count } = await supabase
        .from("saved_videos")
        .select("*", { count: "exact", head: true })
        .eq("video_id", video.id);
      
      setSavesCount(count || 0);
    };

    checkLikeStatus();
    checkSavedStatus();
    fetchSavesCount();
  }, [video.id, currentUserId]);

  // Auto-play when video comes into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isInViewRef.current = entry.isIntersecting;
          if (entry.isIntersecting) {
            if (!hasViewed) {
              trackView();
              setHasViewed(true);
            }
            // Try to play immediately
            if (videoRef.current) {
              videoRef.current.play().then(() => {
                setIsPlaying(true);
                setIsVideoReady(true);
              }).catch(() => {
                // Autoplay blocked, still mark as ready
                setIsVideoReady(true);
              });
            }
          } else {
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

  // Mark video ready when it can play
  const handleVideoReady = () => {
    setIsVideoReady(true);
  };

  // Handle video load errors
  const handleVideoError = () => {
    console.error("Video failed to load:", videoSrc);
    setIsVideoReady(true); // Still show UI even if video fails
  };

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
      navigate("/auth");
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

  const toggleSave = async () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }

    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_videos")
          .delete()
          .eq("video_id", video.id)
          .eq("user_id", currentUserId);

        if (error) throw error;
        
        setIsSaved(false);
        setSavesCount((prev) => prev - 1);
        toast.success("Removed from saved");
      } else {
        const { error } = await supabase.from("saved_videos").insert({
          video_id: video.id,
          user_id: currentUserId,
        });

        if (error) throw error;
        
        setIsSaved(true);
        setSavesCount((prev) => prev + 1);
        toast.success("Saved to your profile");
      }
    } catch (error: any) {
      toast.error("Failed to save video");
      console.error("Error toggling save:", error);
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
    setIsShareOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!currentUserId || video.user_id !== currentUserId) {
      toast.error("You can only delete your own videos");
      return;
    }

    try {
      const { error } = await supabase
        .from("videos")
        .delete()
        .eq("id", video.id);

      if (error) throw error;

      toast.success("Video deleted successfully");
      if (onDelete) {
        onDelete(video.id);
      }
    } catch (error: any) {
      console.error("Error deleting video:", error);
      toast.error(error.message || "Failed to delete video");
    }
  };

  const isOwnVideo = currentUserId === video.user_id;

  const handleComment = () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }
    setIsCommentsOpen(true);
  };

  const handleCategoryClick = (tag: string) => {
    // Close any modal first
    onNavigate?.();
    // Use window.location for reliable navigation with query params
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  // Use optimized URL if available, fallback to original
  const videoSrc = video.optimized_video_url || video.video_url;
  const posterSrc = video.thumbnail_url || undefined;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen snap-start snap-always bg-black overflow-hidden"
    >
      {/* Loading indicator - show for max 3 seconds then hide */}
      {!isVideoReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-5">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        className="absolute inset-0 w-full h-full object-cover md:object-contain"
        loop
        playsInline
        muted
        preload="auto"
        onCanPlayThrough={handleVideoReady}
        onLoadedData={handleVideoReady}
        onError={handleVideoError}
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

      {/* Right side actions (TikTok style) - positioned above nav bar */}
      <div className="absolute right-4 bottom-44 flex flex-col gap-6 z-10">
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
          <span className="text-white text-xs font-semibold">{commentsCount}</span>
        </button>

        <button
          onClick={toggleSave}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Bookmark
              className={cn(
                "h-7 w-7",
                isSaved ? "fill-yellow-500 text-yellow-500" : "text-white"
              )}
            />
          </div>
          <span className="text-white text-xs font-semibold">{savesCount}</span>
        </button>

        <button
          onClick={handleShare}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Share2 className="h-7 w-7 text-white" />
          </div>
        </button>

        {isOwnVideo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
                  <MoreVertical className="h-7 w-7 text-white" />
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background border-border z-50">
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Bottom info - positioned above nav bar with space for action buttons */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-24 z-10 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" style={{ paddingRight: '80px' }}>
        <div className="space-y-2 pointer-events-auto">
          <div 
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit"
            onClick={handleProfileClick}
          >
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

          {video.description && (
            <p className="text-white/90 text-sm">{video.description}</p>
          )}

          {video.tags && video.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {video.tags.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCategoryClick(tag);
                  }}
                  className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comments drawer */}
      <CommentsDrawer
        videoId={video.id}
        isOpen={isCommentsOpen}
        onClose={() => setIsCommentsOpen(false)}
        currentUserId={currentUserId}
        onCommentAdded={() => setCommentsCount(commentsCount + 1)}
      />

      {/* Share drawer */}
      <ShareDrawer
        videoTitle={video.title}
        username={video.profiles.username}
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
      />
    </div>
  );
};
