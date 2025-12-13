import { useState, useRef, useEffect, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Volume2, VolumeX, Loader2, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getBestThumbnailUrl, getBestVideoSource } from "@/lib/cloudinary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Global mute state
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();
const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(fn => fn(muted));
};

// Guest client ID for anonymous likes
const getGuestClientId = (): string => {
  const key = 'guest_client_id';
  let clientId = localStorage.getItem(key);
  if (!clientId) {
    clientId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(key, clientId);
  }
  return clientId;
};

// Guest likes storage
const getGuestLikes = (): string[] => {
  try {
    const likes = localStorage.getItem('guest_likes_v1');
    return likes ? JSON.parse(likes) : [];
  } catch {
    return [];
  }
};

const setGuestLikes = (likes: string[]) => {
  localStorage.setItem('guest_likes_v1', JSON.stringify(likes));
};

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  tags: string[] | null;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface FeedItemProps {
  video: Video;
  index: number;
  isActive: boolean;
  currentUserId: string | null;
  hasEntered: boolean;
  onDelete?: (videoId: string) => void;
  onViewTracked: (videoId: string) => void;
}

export const FeedItem = memo(({ 
  video, 
  index,
  isActive,
  currentUserId, 
  hasEntered,
  onDelete,
  onViewTracked
}: FeedItemProps) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackedRef = useRef(false);
  
  const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);
  const videoSrc = getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    null,
    video.video_url
  );
  
  // Video state
  const [videoStatus, setVideoStatus] = useState<"loading" | "ready" | "error" | "needsInteraction">("loading");
  const [muted, setMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  
  // UI state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isShareOpen, setIsShareOpen] = useState(false);

  // Sync global mute
  useEffect(() => {
    const listener = (m: boolean) => {
      setMuted(m);
      if (videoRef.current) videoRef.current.muted = m;
    };
    muteListeners.add(listener);
    return () => { muteListeners.delete(listener); };
  }, []);

  // Handle video playback based on isActive
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (isActive && hasEntered) {
      el.currentTime = 0;
      el.play()
        .then(() => {
          setVideoStatus("ready");
          if (!trackedRef.current) {
            trackedRef.current = true;
            onViewTracked(video.id);
          }
        })
        .catch(err => {
          if (err.name === "NotAllowedError") {
            setVideoStatus("needsInteraction");
          }
        });
    } else {
      el.pause();
    }
  }, [isActive, hasEntered, video.id, onViewTracked]);

  // Check if guest has liked this video
  useEffect(() => {
    if (!currentUserId) {
      const guestLikes = getGuestLikes();
      setIsLiked(guestLikes.includes(video.id));
    }
  }, [video.id, currentUserId]);

  // Fetch interaction states for logged-in users
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

  const handleCanPlay = useCallback(() => setVideoStatus("ready"), []);
  const handleError = useCallback(() => setVideoStatus("error"), []);

  const toggleMute = useCallback(() => {
    setGlobalMuted(!muted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [muted]);

  const handleVideoTap = useCallback(() => {
    if (videoStatus === "needsInteraction") {
      videoRef.current?.play().then(() => setVideoStatus("ready")).catch(() => {});
    } else {
      toggleMute();
    }
  }, [videoStatus, toggleMute]);

  const toggleLike = async () => {
    const clientId = getGuestClientId();
    const wasLiked = isLiked;
    
    setIsLiked(!wasLiked);
    setLikesCount(prev => wasLiked ? prev - 1 : prev + 1);

    try {
      const { data, error } = await supabase.functions.invoke('like-video', {
        body: {
          videoId: video.id,
          clientId: currentUserId || clientId,
          action: wasLiked ? 'unlike' : 'like'
        }
      });

      if (error) throw error;

      if (data?.likesCount !== undefined) {
        setLikesCount(data.likesCount);
      }

      if (!currentUserId) {
        const guestLikes = getGuestLikes();
        if (wasLiked) {
          setGuestLikes(guestLikes.filter(id => id !== video.id));
        } else {
          setGuestLikes([...guestLikes, video.id]);
        }
      }
    } catch (error) {
      setIsLiked(wasLiked);
      setLikesCount(prev => wasLiked ? prev + 1 : prev - 1);
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
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  const isOwnVideo = currentUserId === video.user_id;

  return (
    <div 
      className="relative w-full bg-black flex items-center justify-center flex-shrink-0 snap-start snap-always"
      style={{ height: '100dvh' }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={isActive ? videoSrc : undefined}
        poster={posterSrc}
        className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black"
        loop
        playsInline
        muted={muted}
        preload={isActive ? "auto" : "none"}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onClick={handleVideoTap}
      />

      {/* Thumbnail fallback when not active */}
      {!isActive && posterSrc && (
        <img 
          src={posterSrc} 
          alt="" 
          className="absolute inset-0 w-full h-full object-cover md:object-contain"
          loading={index === 0 ? "eager" : "lazy"}
        />
      )}

      {/* Loading indicator */}
      {isActive && videoStatus === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-black/50 rounded-full p-3">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Tap to play overlay */}
      {isActive && videoStatus === "needsInteraction" && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <button onClick={handleVideoTap} className="flex flex-col items-center gap-2 bg-black/70 rounded-xl px-6 py-4">
            <Play className="h-10 w-10 text-white fill-white" />
            <span className="text-white text-sm">Tap to play</span>
          </button>
        </div>
      )}

      {/* Mute flash */}
      {showMuteIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-black/50 rounded-full p-4">
            {muted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Mute indicator button */}
      <button 
        onClick={toggleMute}
        className="absolute bottom-[180px] right-4 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-black/50"
      >
        {muted ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-white" />}
      </button>

      {/* Right side actions */}
      <div className="absolute right-4 bottom-[240px] flex flex-col gap-5 z-30">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-6 w-6", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{likesCount}</span>
        </button>

        <button onClick={toggleSave} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Bookmark className={cn("h-6 w-6", isSaved ? "fill-yellow-500 text-yellow-500" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{savesCount}</span>
        </button>

        <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Share2 className="h-6 w-6 text-white" />
          </div>
        </button>

        {isOwnVideo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col items-center gap-1">
                <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
                  <MoreVertical className="h-6 w-6 text-white" />
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
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[100px] z-30 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none pr-[80px]">
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

      <ShareDrawer videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />
    </div>
  );
});

FeedItem.displayName = 'FeedItem';
