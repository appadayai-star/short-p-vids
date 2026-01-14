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
  
  const [isMuted, setIsMuted] = useState(globalMuted);
  
  // Double-tap like animation state
  const [doubleTapHearts, setDoubleTapHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const lastTapTimeRef = useRef<number>(0);
  const lastTapPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const doubleTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Progress bar state
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);

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
            // View tracking is now handled by useWatchMetrics hook
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
  }, [isTrulyActive, status, hasEntered, index]);

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

  // View tracking is now handled by useWatchMetrics hook in FeedItem

  // Video event handlers
  const handleCanPlay = useCallback(() => {
    console.log(`[VideoCard ${index}] canplay`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout, index]);


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

  // Progress bar handlers
  const handleTimeUpdate = useCallback(() => {
    const videoEl = videoRef.current;
    if (videoEl && !isScrubbing) {
      setProgress(videoEl.currentTime);
      setDuration(videoEl.duration || 0);
    }
  }, [isScrubbing]);

  const handleLoadedMetadataWithDuration = useCallback(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
      setDuration(videoEl.duration || 0);
    }
    console.log(`[VideoCard ${index}] loadedmetadata`);
  }, [index]);

  const seekToPosition = useCallback((clientX: number) => {
    const bar = progressBarRef.current;
    const videoEl = videoRef.current;
    if (!bar || !videoEl || !duration) return;
    
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const newTime = percent * duration;
    
    videoEl.currentTime = newTime;
    setProgress(newTime);
  }, [duration]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsScrubbing(true);
    seekToPosition(e.clientX);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      seekToPosition(moveEvent.clientX);
    };
    
    const handleMouseUp = () => {
      setIsScrubbing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [seekToPosition]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsScrubbing(true);
    seekToPosition(e.touches[0].clientX);
    
    const handleTouchMove = (moveEvent: TouchEvent) => {
      seekToPosition(moveEvent.touches[0].clientX);
    };
    
    const handleTouchEnd = () => {
      setIsScrubbing(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  }, [seekToPosition]);

  // User actions
  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  // Handle double-tap like with heart animation
  const triggerHeartAnimation = useCallback((x: number, y: number) => {
    // Add heart animation at tap position
    const heartId = Date.now();
    setDoubleTapHearts(prev => [...prev, { id: heartId, x, y }]);
    
    // Remove heart after animation completes
    setTimeout(() => {
      setDoubleTapHearts(prev => prev.filter(h => h.id !== heartId));
    }, 1000);
  }, []);

  const toggleLike = useCallback(async () => {
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
  }, [isLiked, video.id, currentUserId]);

  const handleVideoTap = useCallback((e: React.MouseEvent<HTMLVideoElement | HTMLButtonElement>) => {
    e.preventDefault();
    
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    
    // Get tap position relative to the container
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if this is a double-tap (within 300ms and similar position)
    const isDoubleTapDetected = timeSinceLastTap < 300 && 
      timeSinceLastTap > 50 && // Ignore too-fast clicks (could be browser quirk)
      Math.abs(x - lastTapPositionRef.current.x) < 100 &&
      Math.abs(y - lastTapPositionRef.current.y) < 100;
    
    console.log(`[VideoCard] Tap detected: timeSince=${timeSinceLastTap}ms, isDouble=${isDoubleTapDetected}`);
    
    if (isDoubleTapDetected) {
      // Clear any pending single-tap timeout
      if (doubleTapTimeoutRef.current) {
        clearTimeout(doubleTapTimeoutRef.current);
        doubleTapTimeoutRef.current = null;
      }
      
      // Show heart animation
      triggerHeartAnimation(x, y);
      
      // Like the video if not already liked
      if (!isLiked) {
        toggleLike();
      }
      
      lastTapTimeRef.current = 0; // Reset to prevent triple-tap
    } else {
      // Store tap info for potential double-tap detection
      lastTapTimeRef.current = now;
      lastTapPositionRef.current = { x, y };
      
      // Clear any existing timeout
      if (doubleTapTimeoutRef.current) {
        clearTimeout(doubleTapTimeoutRef.current);
      }
      
      // Delay single-tap action to allow for double-tap detection
      doubleTapTimeoutRef.current = setTimeout(() => {
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
        doubleTapTimeoutRef.current = null;
      }, 300);
    }
  }, [status, toggleMute, triggerHeartAnimation, isLiked, toggleLike]);

  const handleRetry = useCallback(() => {
    console.log(`[VideoCard ${index}] Manual retry`);
    setAttempt(0);
    setSrc(primarySrc);
    setStatus("loading");
  }, [primarySrc, index]);

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
          onLoadedMetadata={handleLoadedMetadataWithDuration}
          onTimeUpdate={handleTimeUpdate}
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

      {/* Double-tap heart animation */}
      {doubleTapHearts.map(heart => (
        <div
          key={heart.id}
          className="absolute pointer-events-none z-30"
          style={{
            left: heart.x - 40,
            top: heart.y - 40,
          }}
        >
          <Heart 
            className="h-20 w-20 fill-primary text-primary animate-double-tap-heart"
            style={{
              filter: 'drop-shadow(0 0 10px rgba(255, 0, 0, 0.5))',
            }}
          />
        </div>
      ))}

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

      {/* Progress bar - positioned above nav bar */}
      {duration > 0 && isTrulyActive && (
        <div 
          ref={progressBarRef}
          className="absolute bottom-[72px] left-0 right-0 h-6 z-30 cursor-pointer group"
          onMouseDown={handleProgressMouseDown}
          onTouchStart={handleProgressTouchStart}
        >
          {/* Track background */}
          <div className="absolute bottom-2 left-0 right-0 h-[3px] bg-white/30 rounded-full transition-all group-hover:h-[5px] group-active:h-[5px]">
            {/* Progress fill */}
            <div 
              className="absolute inset-y-0 left-0 bg-yellow-primary rounded-full"
              style={{ width: `${(progress / duration) * 100}%` }}
            />
            {/* Scrubber dot */}
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-yellow-primary rounded-full shadow-md transition-transform scale-0 group-hover:scale-100 group-active:scale-125"
              style={{ left: `calc(${(progress / duration) * 100}% - 6px)` }}
            />
          </div>
        </div>
      )}
    </div>
  );
});

VideoCard.displayName = 'VideoCard';
