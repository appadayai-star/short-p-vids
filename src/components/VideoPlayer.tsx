import { useState, useRef, useEffect, memo } from "react";
import { Heart, MessageCircle, Share2, Bookmark, MoreVertical, Trash2, Pause, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

interface VideoPlayerProps {
  video: Video;
  currentUserId: string | null;
  isActive: boolean;
  onDelete?: (videoId: string) => void;
  onNavigate?: () => void;
}

export const VideoPlayer = memo(({ video, currentUserId, isActive, onDelete, onNavigate }: VideoPlayerProps) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [commentsCount, setCommentsCount] = useState(video.comments_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [hasTrackedView, setHasTrackedView] = useState(false);

  // Get video source - prefer optimized, fallback to original
  const videoSrc = video.optimized_video_url || video.video_url;

  // Play/pause based on active state
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (isActive) {
      videoEl.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        // Autoplay blocked - that's okay
      });

      // Track view once
      if (!hasTrackedView) {
        trackView();
        setHasTrackedView(true);
      }
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }
  }, [isActive, hasTrackedView]);

  // Fetch interaction states
  useEffect(() => {
    if (!currentUserId) return;

    const fetchStates = async () => {
      const [likeResult, saveResult, savesCountResult] = await Promise.all([
        supabase.from("likes").select("id").eq("video_id", video.id).eq("user_id", currentUserId).maybeSingle(),
        supabase.from("saved_videos").select("id").eq("video_id", video.id).eq("user_id", currentUserId).maybeSingle(),
        supabase.from("saved_videos").select("*", { count: "exact", head: true }).eq("video_id", video.id)
      ]);

      setIsLiked(!!likeResult.data);
      setIsSaved(!!saveResult.data);
      setSavesCount(savesCountResult.count || 0);
    };

    fetchStates();
  }, [video.id, currentUserId]);

  const trackView = async () => {
    try {
      await supabase.from("video_views").insert({
        video_id: video.id,
        user_id: currentUserId,
      });
      await supabase.from("videos").update({ views_count: video.views_count + 1 }).eq("id", video.id);
    } catch (error) {
      // Silent fail for view tracking
    }
  };

  const togglePlay = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (isPlaying) {
      videoEl.pause();
      setIsPlaying(false);
    } else {
      videoEl.play();
      setIsPlaying(true);
    }
    
    setShowPlayIcon(true);
    setTimeout(() => setShowPlayIcon(false), 500);
  };

  const toggleLike = async () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }

    try {
      if (isLiked) {
        await supabase.from("likes").delete().eq("video_id", video.id).eq("user_id", currentUserId);
        setIsLiked(false);
        setLikesCount(prev => prev - 1);
      } else {
        await supabase.from("likes").insert({ video_id: video.id, user_id: currentUserId });
        setIsLiked(true);
        setLikesCount(prev => prev + 1);
      }
    } catch (error) {
      toast.error("Failed to update like");
    }
  };

  const toggleSave = async () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }

    try {
      if (isSaved) {
        await supabase.from("saved_videos").delete().eq("video_id", video.id).eq("user_id", currentUserId);
        setIsSaved(false);
        setSavesCount(prev => prev - 1);
        toast.success("Removed from saved");
      } else {
        await supabase.from("saved_videos").insert({ video_id: video.id, user_id: currentUserId });
        setIsSaved(true);
        setSavesCount(prev => prev + 1);
        toast.success("Saved");
      }
    } catch (error) {
      toast.error("Failed to save video");
    }
  };

  const handleComment = () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }
    setIsCommentsOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || video.user_id !== currentUserId) return;

    try {
      await supabase.from("videos").delete().eq("id", video.id);
      toast.success("Video deleted");
      onDelete?.(video.id);
    } catch (error) {
      toast.error("Failed to delete video");
    }
  };

  const handleCategoryClick = (tag: string) => {
    onNavigate?.();
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  const isOwnVideo = currentUserId === video.user_id;

  return (
    <div className="relative w-full h-screen snap-start snap-always bg-black flex items-center justify-center">
      {/* Video */}
      <video
        ref={videoRef}
        src={videoSrc}
        className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black"
        loop
        playsInline
        muted
        preload="auto"
        onClick={togglePlay}
      />

      {/* Play/Pause indicator */}
      {showPlayIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isPlaying ? <Play className="h-12 w-12 text-white fill-white" /> : <Pause className="h-12 w-12 text-white fill-white" />}
          </div>
        </div>
      )}

      {/* Right side actions */}
      <div className="absolute right-4 bottom-44 flex flex-col gap-6 z-10">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-7 w-7", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{likesCount}</span>
        </button>

        <button onClick={handleComment} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <MessageCircle className="h-7 w-7 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">{commentsCount}</span>
        </button>

        <button onClick={toggleSave} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Bookmark className={cn("h-7 w-7", isSaved ? "fill-yellow-500 text-yellow-500" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{savesCount}</span>
        </button>

        <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center gap-1">
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
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive cursor-pointer">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-24 z-10 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" style={{ paddingRight: '80px' }}>
        <div className="space-y-2 pointer-events-auto">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit" onClick={handleProfileClick}>
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border-2 border-primary">
              {video.profiles.avatar_url ? (
                <img src={video.profiles.avatar_url} alt={video.profiles.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                  {video.profiles.username[0].toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-white font-semibold">@{video.profiles.username}</span>
          </div>

          {video.description && <p className="text-white/90 text-sm">{video.description}</p>}

          {video.tags && video.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {video.tags.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); handleCategoryClick(tag); }}
                  className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <CommentsDrawer videoId={video.id} isOpen={isCommentsOpen} onClose={() => setIsCommentsOpen(false)} currentUserId={currentUserId} onCommentAdded={() => setCommentsCount(c => c + 1)} />
      <ShareDrawer videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
