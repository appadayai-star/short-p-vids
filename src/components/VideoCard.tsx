import { useState, useRef, useEffect, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Volume2, VolumeX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Global mute state - persisted across videos
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();

const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(listener => listener(muted));
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

interface VideoCardProps {
  video: Video;
  index: number;
  currentUserId: string | null;
  shouldPreload: boolean;
  isFirstVideo: boolean;
  hasEntered: boolean;
  onActiveChange: (index: number, isActive: boolean) => void;
  onDelete?: (videoId: string) => void;
  onNavigate?: () => void;
}

export const VideoCard = memo(({ 
  video, 
  index,
  currentUserId, 
  shouldPreload,
  isFirstVideo,
  hasEntered,
  onActiveChange,
  onDelete, 
  onNavigate 
}: VideoCardProps) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isVisible, setIsVisible] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [videoLoaded, setVideoLoaded] = useState(false);

  // Get video source - prefer optimized, fallback to original
  const videoSrc = video.optimized_video_url || video.video_url;
  const posterSrc = video.thumbnail_url || undefined;

  // Sync with global mute state
  useEffect(() => {
    const listener = (muted: boolean) => {
      setIsMuted(muted);
      if (videoRef.current) {
        videoRef.current.muted = muted;
      }
    };
    muteListeners.add(listener);
    return () => {
      muteListeners.delete(listener);
    };
  }, []);

  // Check if guest has liked this video
  useEffect(() => {
    if (!currentUserId) {
      const guestLikes = getGuestLikes();
      setIsLiked(guestLikes.includes(video.id));
    }
  }, [video.id, currentUserId]);

  // IntersectionObserver to detect visibility and active state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const isIntersecting = entry.isIntersecting;
          const ratio = entry.intersectionRatio;
          
          // Visible if any part is showing
          setIsVisible(isIntersecting);
          
          // Active if more than 50% visible
          const nowActive = ratio > 0.5;
          if (nowActive !== isActive) {
            setIsActive(nowActive);
            onActiveChange(index, nowActive);
          }
        });
      },
      { 
        threshold: [0, 0.5, 1],
        rootMargin: '0px'
      }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [index, isActive, onActiveChange]);

  // Handle video play/pause based on active state and entry
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Only play if: active, loaded, AND user has entered
    if (isActive && videoLoaded && hasEntered) {
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {
        // Autoplay blocked - that's okay
      });

      // Track view once
      if (!hasTrackedView) {
        trackView();
        setHasTrackedView(true);
      }
    } else {
      videoEl.pause();
    }
  }, [isActive, videoLoaded, hasEntered, hasTrackedView]);

  // Fetch interaction states for logged-in users
  useEffect(() => {
    if (!currentUserId || !isVisible) return;

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
  }, [video.id, currentUserId, isVisible]);

  const trackView = async () => {
    try {
      await supabase.from("video_views").insert({
        video_id: video.id,
        user_id: currentUserId,
      });
    } catch (error) {
      // Silent fail for view tracking
    }
  };

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  const toggleLike = async () => {
    const clientId = getGuestClientId();
    const wasLiked = isLiked;
    
    // Optimistic UI update
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

      // Update guest likes in localStorage
      if (!currentUserId) {
        const guestLikes = getGuestLikes();
        if (wasLiked) {
          setGuestLikes(guestLikes.filter(id => id !== video.id));
        } else {
          setGuestLikes([...guestLikes, video.id]);
        }
      }
    } catch (error) {
      // Revert on error
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
    onNavigate?.();
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  // === TEMPORARY DEBUG HANDLERS (REMOVE IN PRODUCTION) ===
  const logVideoEvent = useCallback((event: string, videoEl: HTMLVideoElement | null) => {
    if (!videoEl) return;
    console.log(`[VideoCard ${index}] ${event}`, {
      src: videoEl.src?.substring(0, 80) + '...',
      networkState: ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'][videoEl.networkState],
      readyState: ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][videoEl.readyState],
      paused: videoEl.paused,
      currentTime: videoEl.currentTime,
      duration: videoEl.duration,
      error: videoEl.error?.message || null
    });
  }, [index]);

  const handleVideoCanPlay = useCallback(() => {
    logVideoEvent('canplay', videoRef.current);
    setVideoLoaded(true);
  }, [logVideoEvent]);

  const handleVideoLoadedMetadata = useCallback(() => {
    logVideoEvent('loadedmetadata', videoRef.current);
  }, [logVideoEvent]);

  const handleVideoPlaying = useCallback(() => {
    logVideoEvent('playing', videoRef.current);
  }, [logVideoEvent]);

  const handleVideoStalled = useCallback(() => {
    logVideoEvent('stalled', videoRef.current);
  }, [logVideoEvent]);

  const handleVideoWaiting = useCallback(() => {
    logVideoEvent('waiting', videoRef.current);
  }, [logVideoEvent]);

  const handleVideoError = useCallback(() => {
    logVideoEvent('error', videoRef.current);
    console.error(`[VideoCard ${index}] VIDEO ERROR:`, videoRef.current?.error);
  }, [logVideoEvent, index]);

  const handleVideoAbort = useCallback(() => {
    logVideoEvent('abort', videoRef.current);
  }, [logVideoEvent]);

  const handleVideoEmptied = useCallback(() => {
    logVideoEvent('emptied', videoRef.current);
  }, [logVideoEvent]);
  // === END TEMPORARY DEBUG HANDLERS ===

  const isOwnVideo = currentUserId === video.user_id;

  // Determine if we should render the video element
  // First video always renders, others render when visible or should preload
  const shouldRenderVideo = isFirstVideo || isVisible || shouldPreload;
  
  // Determine preload attribute - first video aggressively preloads
  const getPreloadValue = () => {
    if (isFirstVideo) return "auto";
    if (isActive) return "auto";
    if (shouldPreload) return "metadata";
    return "none";
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center"
    >
      {/* Thumbnail background - always visible as fallback */}
      {posterSrc && (
        <img 
          src={posterSrc} 
          alt="" 
          className={cn(
            "absolute inset-0 w-full h-full object-cover md:object-contain",
            shouldRenderVideo && videoLoaded ? "opacity-0" : "opacity-100"
          )}
          loading={isFirstVideo ? "eager" : "lazy"}
        />
      )}

      {/* Video - rendered when needed, always sets src for first video */}
      {shouldRenderVideo && (
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black"
          loop
          playsInline
          muted={isMuted}
          preload={getPreloadValue()}
          poster={posterSrc}
          onClick={toggleMute}
          onCanPlay={handleVideoCanPlay}
          onLoadedMetadata={handleVideoLoadedMetadata}
          onPlaying={handleVideoPlaying}
          onStalled={handleVideoStalled}
          onWaiting={handleVideoWaiting}
          onError={handleVideoError}
          onAbort={handleVideoAbort}
          onEmptied={handleVideoEmptied}
          // @ts-ignore - fetchpriority is valid
          fetchpriority={isFirstVideo ? "high" : "auto"}
        />
      )}

      {/* Mute/Unmute indicator */}
      {showMuteIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isMuted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Mute indicator in corner */}
      <div className="absolute bottom-[120px] right-4 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm pointer-events-none">
        {isMuted ? (
          <VolumeX className="h-5 w-5 text-white" />
        ) : (
          <Volume2 className="h-5 w-5 text-white" />
        )}
      </div>

      {/* Right side actions */}
      <div className="absolute right-4 bottom-[180px] flex flex-col gap-6 z-10">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-7 w-7", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{likesCount}</span>
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
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[100px] z-10 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none pr-[80px]">
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

VideoCard.displayName = 'VideoCard';
