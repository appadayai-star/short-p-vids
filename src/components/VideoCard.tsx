import { useState, useRef, useEffect, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Volume2, VolumeX, Loader2, RefreshCw, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getBestVideoSource, getBestThumbnailUrl, supportsHlsNatively } from "@/lib/cloudinary";
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

type VideoStatus = "idle" | "loading" | "ready" | "error" | "stalled" | "needsInteraction";

interface VideoCardProps {
  video: Video;
  index: number;
  activeIndex: number;
  currentUserId: string | null;
  shouldPreload: boolean;
  isFirstVideo: boolean;
  hasEntered: boolean;
  onActiveChange: (index: number, isActive: boolean) => void;
  onDelete?: (videoId: string) => void;
  onNavigate?: () => void;
}

const MAX_RETRY_ATTEMPTS = 2;
const LOAD_TIMEOUT_MS = 5000;

export const VideoCard = memo(({ 
  video, 
  index,
  activeIndex,
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
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Core video state - use dynamic Cloudinary URLs when available
  const primarySrc = getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    video.stream_url || null,
    video.video_url
  );
  const fallbackSrc = video.optimized_video_url || video.video_url;
  const lastResortSrc = video.video_url;
  const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);
  
  const [src, setSrc] = useState(primarySrc);
  const [status, setStatus] = useState<VideoStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  
  // UI state
  const [isVisible, setIsVisible] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [isMuted, setIsMuted] = useState(globalMuted);

  // Compute truly active - only one video can be active at a time
  const isTrulyActive = index === activeIndex;
  
  // Should this video have a src loaded?
  const shouldLoadSrc = isFirstVideo || isTrulyActive || shouldPreload || isVisible;

  // Clear timeout helper
  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Retry or fallback logic with 3 levels: primary -> fallback -> lastResort
  const retryOrFallback = useCallback((reason: "error" | "timeout") => {
    clearLoadTimeout();
    
    console.log(`[VideoCard ${index}] retryOrFallback: reason=${reason}, attempt=${attempt}, src=${src?.substring(0, 60)}...`);
    
    if (attempt === 0) {
      // First retry: reload primary with cache buster
      setAttempt(1);
      const cacheBuster = primarySrc.includes("?") ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
      setSrc(primarySrc + cacheBuster);
      setStatus("loading");
    } else if (attempt === 1 && fallbackSrc && fallbackSrc !== primarySrc) {
      // Second retry: try optimized MP4 fallback
      console.log(`[VideoCard ${index}] Trying fallback: ${fallbackSrc.substring(0, 60)}...`);
      setAttempt(2);
      setSrc(fallbackSrc);
      setStatus("loading");
    } else if (attempt <= 2 && lastResortSrc && lastResortSrc !== fallbackSrc && lastResortSrc !== primarySrc) {
      // Third retry: try original Supabase URL
      console.log(`[VideoCard ${index}] Trying lastResort: ${lastResortSrc.substring(0, 60)}...`);
      setAttempt(3);
      setSrc(lastResortSrc);
      setStatus("loading");
    } else {
      // All retries exhausted - show error UI
      console.log(`[VideoCard ${index}] All retries exhausted, showing error UI`);
      setStatus("error");
    }
  }, [attempt, primarySrc, fallbackSrc, lastResortSrc, src, clearLoadTimeout, index]);

  // Start loading timeout watchdog
  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      console.log(`[VideoCard ${index}] Load timeout triggered`);
      setStatus("stalled");
      retryOrFallback("timeout");
    }, LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout, retryOrFallback, index]);

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

  // IntersectionObserver to detect visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const isIntersecting = entry.isIntersecting;
          const ratio = entry.intersectionRatio;
          
          setIsVisible(isIntersecting);
          
          // Report active state if >50% visible
          const nowActive = ratio > 0.5;
          onActiveChange(index, nowActive);
        });
      },
      { 
        threshold: [0, 0.5, 1],
        rootMargin: '0px'
      }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [index, onActiveChange]);

  // Handle src assignment and resource cleanup
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (shouldLoadSrc) {
      // Assign src and start loading
      if (videoEl.src !== src && src) {
        videoEl.src = src;
        setStatus("loading");
        startLoadTimeout();
        videoEl.load();
      }
    } else {
      // Detach src to prevent downloads and free memory
      if (videoEl.src) {
        videoEl.pause();
        videoEl.src = "";
        videoEl.load();
        setStatus("idle");
        clearLoadTimeout();
      }
    }
  }, [shouldLoadSrc, src, startLoadTimeout, clearLoadTimeout]);

  // When src changes (retry/fallback), reload video
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !shouldLoadSrc) return;
    
    if (status === "loading" && attempt > 0) {
      videoEl.src = src;
      videoEl.load();
      startLoadTimeout();
    }
  }, [src, attempt, status, shouldLoadSrc, startLoadTimeout]);

  // Handle video play/pause based on active state and entry
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Only play if: truly active, ready, AND user has entered
    if (isTrulyActive && status === "ready" && hasEntered) {
      videoEl.currentTime = 0;
      const playPromise = videoEl.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Track view once
            if (!hasTrackedView) {
              trackView();
              setHasTrackedView(true);
            }
          })
          .catch((error) => {
            console.log(`[VideoCard ${index}] play() rejected:`, error.name);
            // Autoplay blocked - show tap to play
            if (error.name === "NotAllowedError") {
              setStatus("needsInteraction");
            }
          });
      }
    } else {
      videoEl.pause();
    }
  }, [isTrulyActive, status, hasEntered, hasTrackedView, index]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLoadTimeout();
    };
  }, [clearLoadTimeout]);

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

  // Video event handlers
  const handleCanPlay = useCallback(() => {
    console.log(`[VideoCard ${index}] canplay`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout, index]);

  const handleLoadedMetadata = useCallback(() => {
    console.log(`[VideoCard ${index}] loadedmetadata`);
  }, [index]);

  const handlePlaying = useCallback(() => {
    console.log(`[VideoCard ${index}] playing`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout, index]);

  const handleWaiting = useCallback(() => {
    console.log(`[VideoCard ${index}] waiting (buffering)`);
  }, [index]);

  const handleStalled = useCallback(() => {
    console.log(`[VideoCard ${index}] stalled`);
    // Don't immediately error - network might recover
  }, [index]);

  const handleError = useCallback(() => {
    const videoEl = videoRef.current;
    console.error(`[VideoCard ${index}] error:`, videoEl?.error?.message);
    clearLoadTimeout();
    retryOrFallback("error");
  }, [clearLoadTimeout, retryOrFallback, index]);

  // User actions
  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  const handleVideoTap = useCallback(() => {
    if (status === "needsInteraction") {
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.play().then(() => {
          setStatus("ready");
        }).catch(() => {
          // Still blocked
        });
      }
    } else {
      toggleMute();
    }
  }, [status, toggleMute]);

  const handleRetry = useCallback(() => {
    console.log(`[VideoCard ${index}] Manual retry`);
    setAttempt(0);
    setSrc(primarySrc);
    setStatus("loading");
  }, [primarySrc, index]);

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
    onNavigate?.();
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  const isOwnVideo = currentUserId === video.user_id;
  const showVideo = shouldLoadSrc && status !== "idle";
  const showLoading = status === "loading" && isTrulyActive;
  const showError = status === "error" || status === "stalled";
  const showTapToPlay = status === "needsInteraction" && isTrulyActive;

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
            showVideo && status === "ready" ? "opacity-0" : "opacity-100"
          )}
          loading={isFirstVideo ? "eager" : "lazy"}
        />
      )}

      {/* Video element - only rendered when needed */}
      {shouldLoadSrc && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black"
          loop
          playsInline
          muted={isMuted}
          preload={isTrulyActive || isFirstVideo ? "auto" : "metadata"}
          poster={posterSrc}
          onClick={handleVideoTap}
          onCanPlay={handleCanPlay}
          onLoadedMetadata={handleLoadedMetadata}
          onPlaying={handlePlaying}
          onWaiting={handleWaiting}
          onStalled={handleStalled}
          onError={handleError}
        />
      )}

      {/* Loading spinner overlay */}
      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-black/50 rounded-full p-3">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Error/Retry overlay */}
      {showError && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <button
            onClick={handleRetry}
            className="flex flex-col items-center gap-2 bg-black/70 rounded-xl px-6 py-4 hover:bg-black/80 transition-colors"
          >
            <RefreshCw className="h-10 w-10 text-white" />
            <span className="text-white text-sm font-medium">Tap to retry</span>
          </button>
        </div>
      )}

      {/* Tap to play overlay (autoplay blocked) */}
      {showTapToPlay && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <button
            onClick={handleVideoTap}
            className="flex flex-col items-center gap-2 bg-black/70 rounded-xl px-6 py-4 hover:bg-black/80 transition-colors"
          >
            <Play className="h-10 w-10 text-white fill-white" />
            <span className="text-white text-sm font-medium">Tap to play</span>
          </button>
        </div>
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

      <ShareDrawer videoId={video.id} videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />
    </div>
  );
});

VideoCard.displayName = 'VideoCard';
