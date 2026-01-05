import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Volume2, VolumeX, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getBestVideoSource, getBestThumbnailUrl, videoLog } from "@/lib/cloudinary";
import { useWatchMetrics } from "@/hooks/use-watch-metrics";
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

interface FeedItemProps {
  video: Video;
  index: number;
  isActive: boolean;
  shouldPreload?: boolean;
  hasEntered: boolean;
  currentUserId: string | null;
  onViewTracked: (videoId: string) => void;
  onDelete?: (videoId: string) => void;
}

export const FeedItem = memo(({ 
  video, 
  index,
  isActive,
  shouldPreload = false,
  hasEntered,
  currentUserId, 
  onViewTracked,
  onDelete,
}: FeedItemProps) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryCountRef = useRef(0);

  // Watch metrics tracking - hook handles TTFF and watch time via event listeners
  const {
    markLoadStart,
    stopWatching,
  } = useWatchMetrics({
    videoId: video.id,
    userId: currentUserId,
    isActive,
    videoRef,
    videoIndex: index,
    onViewRecorded: () => onViewTracked(video.id),
  });
  
  // UI state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const srcAssignedTimeRef = useRef<number>(0);

  // Video sources - ALWAYS have a poster
  const videoSrc = getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    video.stream_url || null,
    video.video_url
  );
  const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);

  // Log when src is assigned
  useEffect(() => {
    if ((isActive || shouldPreload) && videoSrc) {
      srcAssignedTimeRef.current = performance.now();
      videoLog(`src assigned for index ${index}:`, videoSrc.substring(0, 80));
    }
  }, [isActive, shouldPreload, videoSrc, index]);


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

  // Play/pause based on isActive - metrics tracked via event listeners in hook
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (isActive && hasEntered) {
      setPlaybackFailed(false);
      markLoadStart(); // Start TTFF timer
      videoEl.currentTime = 0;
      
      const attemptPlay = () => {
        const playStartTime = performance.now();
        videoEl.play().then(() => {
          const playingTime = performance.now();
          videoLog(`Playing fired for index ${index}, delay from src:`, 
            Math.round(playingTime - srcAssignedTimeRef.current), 'ms');
        }).catch((err) => {
          if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
            return;
          }
          if (err.name === 'NotSupportedError') {
            retryCountRef.current++;
            if (retryCountRef.current < 3) {
              setTimeout(() => {
                videoEl.load();
                attemptPlay();
              }, 500);
              return;
            }
          }
          setPlaybackFailed(true);
        });
      };

      attemptPlay();
      
      const handleCanPlay = () => {
        videoLog(`canplay for index ${index}, time since src:`, 
          Math.round(performance.now() - srcAssignedTimeRef.current), 'ms');
        attemptPlay();
      };
      videoEl.addEventListener('canplay', handleCanPlay);
      
      return () => {
        videoEl.removeEventListener('canplay', handleCanPlay);
      };
    } else {
      // Stop watching when scrolling away
      stopWatching();
      videoEl.pause();
    }
  }, [isActive, hasEntered, markLoadStart, stopWatching, index]);

  // Log when preloading starts
  useEffect(() => {
    if (shouldPreload && !isActive) {
      videoLog(`Preload started for index ${index}`);
    }
  }, [shouldPreload, isActive, index]);

  const handleRetry = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    
    retryCountRef.current++;
    console.log(`[Video ${index}] RETRY #${retryCountRef.current}:`, {
      currentSrc: videoEl.currentSrc,
      newSrc: videoSrc,
      srcChanged: videoEl.currentSrc !== videoSrc,
    });
    setPlaybackFailed(false);
    videoEl.src = videoSrc;
    videoEl.load();
    console.log(`[Video ${index}] Called load(), attempting play()`);
    videoEl.play().catch((err) => {
      console.error(`[Video ${index}] Retry play failed:`, err);
      setPlaybackFailed(true);
    });
  }, [videoSrc, index]);

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

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

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
  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  return (
    <div 
      className="relative w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always"
      data-video-index={index}
    >
      {/* Poster image as background - ALWAYS visible until video plays */}
      <img 
        src={posterSrc} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover md:object-contain pointer-events-none"
        style={{ paddingBottom: navOffset }}
      />

      {/* Video player - overlays poster */}
      <video
        key={isActive || shouldPreload ? videoSrc : 'inactive'}
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover md:object-contain"
        style={{ paddingBottom: navOffset }}
        src={isActive || shouldPreload ? videoSrc : undefined}
        poster={posterSrc}
        loop
        playsInline
        muted={isMuted}
        preload={isActive || shouldPreload ? "auto" : "none"}
        onClick={toggleMute}
        onError={(e) => {
          const v = e.currentTarget;
          console.error(`[Video ${index}] ERROR:`, {
            currentSrc: v.currentSrc,
            networkState: v.networkState,
            readyState: v.readyState,
            errorCode: v.error?.code,
            errorMessage: v.error?.message,
          });
          setPlaybackFailed(true);
        }}
        onStalled={() => videoLog(`stalled for index ${index}`)}
        onWaiting={() => videoLog(`waiting for index ${index}`)}
        onAbort={() => videoLog(`abort for index ${index}`)}
        onLoadedMetadata={() => videoLog(`loadedmetadata for index ${index}, readyState:`, videoRef.current?.readyState)}
        onCanPlay={() => videoLog(`canplay for index ${index}`)}
        onPlaying={() => videoLog(`playing for index ${index}`)}
      />

      {/* Playback failed - retry UI - pointer-events only on button */}
      {playbackFailed && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/30 pointer-events-none">
          <button 
            onClick={handleRetry}
            className="flex flex-col items-center gap-2 p-4 bg-black/60 rounded-xl backdrop-blur-sm pointer-events-auto"
          >
            <RefreshCw className="h-8 w-8 text-white" />
            <span className="text-white text-sm">Tap to retry</span>
          </button>
        </div>
      )}

      {/* Mute indicator flash */}
      {showMuteIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isMuted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Right side actions */}
      <div 
        className="absolute right-4 flex flex-col items-center gap-5 z-40"
        style={{ bottom: navOffset, paddingBottom: '140px' }}
      >
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-6 w-6", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">{likesCount}</span>
        </button>

        <button onClick={toggleSave} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
            <Bookmark className={cn("h-6 w-6", isSaved ? "fill-yellow-500 text-yellow-500" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">{savesCount}</span>
        </button>

        <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
            <Share2 className="h-6 w-6 text-white" />
          </div>
        </button>

        <button onClick={toggleMute} className="flex flex-col items-center">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
            {isMuted ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-white" />}
          </div>
        </button>

        {isOwnVideo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col items-center">
                <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
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
      <div 
        className="absolute left-0 right-0 p-4 z-40 bg-gradient-to-t from-black via-black/60 to-transparent pr-[80px]"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="space-y-2">
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

FeedItem.displayName = 'FeedItem';