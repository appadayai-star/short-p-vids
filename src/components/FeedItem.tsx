import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Volume2, VolumeX, RefreshCw, Copy, Bug } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getBestThumbnailUrl, getOptimizedVideoUrl } from "@/lib/cloudinary";
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

// Debug mode - enable via ?debug=1 or DEV mode
const isDebugMode = () => {
  if (typeof window === 'undefined') return false;
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
};

// Video error code mapping
const VIDEO_ERROR_CODES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED - Fetching aborted by user',
  2: 'MEDIA_ERR_NETWORK - Network error during download',
  3: 'MEDIA_ERR_DECODE - Error decoding video',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Format not supported',
};

interface VideoEvent {
  time: number;
  event: string;
  detail?: string;
}

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

// Smart video source selection with fallback tracking
function getVideoSource(
  cloudinaryPublicId: string | null,
  originalVideoUrl: string,
  useFallback: boolean
): { src: string; sourceType: 'cloudinary' | 'supabase' } {
  // If fallback mode or no cloudinary ID, use Supabase
  if (useFallback || !cloudinaryPublicId) {
    return { src: originalVideoUrl, sourceType: 'supabase' };
  }
  
  // Use Cloudinary - getOptimizedVideoUrl handles cleanup
  const cloudinaryUrl = getOptimizedVideoUrl(cloudinaryPublicId);
  
  return { src: cloudinaryUrl, sourceType: 'cloudinary' };
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
  const trackedRef = useRef(false);
  const loadStartTimeRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const srcAssignedTimeRef = useRef<number>(0);
  
  // Debug state
  const [debugEvents, setDebugEvents] = useState<VideoEvent[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  
  // UI state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  // Get video source with fallback logic
  const { src: videoSrc, sourceType } = getVideoSource(
    video.cloudinary_public_id || null,
    video.video_url,
    useFallback
  );
  const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);

  // Log debug event
  const logEvent = useCallback((event: string, detail?: string) => {
    const now = performance.now();
    const elapsed = srcAssignedTimeRef.current ? Math.round(now - srcAssignedTimeRef.current) : 0;
    console.log(`[Video ${index}] ${event}${detail ? `: ${detail}` : ''} (+${elapsed}ms)`);
    
    setDebugEvents(prev => {
      const newEvents = [...prev, { time: elapsed, event, detail }];
      return newEvents.slice(-10); // Keep last 10
    });
  }, [index]);

  // Copy debug info to clipboard
  const copyDebugInfo = useCallback(() => {
    const videoEl = videoRef.current;
    const info = {
      videoId: video.id,
      src: videoSrc,
      sourceType,
      cloudinaryPublicId: video.cloudinary_public_id,
      useFallback,
      retryCount: retryCountRef.current,
      error: currentError,
      videoState: videoEl ? {
        readyState: videoEl.readyState,
        networkState: videoEl.networkState,
        paused: videoEl.paused,
        muted: videoEl.muted,
        playsInline: videoEl.playsInline,
        currentTime: videoEl.currentTime,
        duration: videoEl.duration,
      } : null,
      events: debugEvents,
    };
    navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    toast.success('Debug info copied!');
  }, [video.id, videoSrc, sourceType, video.cloudinary_public_id, useFallback, currentError, debugEvents]);

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

  // Play/pause based on isActive - with stall detection and smart fallback
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let stallTimeout: ReturnType<typeof setTimeout> | null = null;
    let isPlaying = false;

    const clearStallTimeout = () => {
      if (stallTimeout) {
        clearTimeout(stallTimeout);
        stallTimeout = null;
      }
    };

    const handlePlayingEvent = () => {
      isPlaying = true;
      clearStallTimeout();
      logEvent('playing', `Source: ${sourceType}`);
      
      // Log metrics
      if (loadStartTimeRef.current) {
        const ttff = Math.round(performance.now() - loadStartTimeRef.current);
        console.log(`[Metrics] Video ${index} | TTFF: ${ttff}ms | Source: ${sourceType} | Retries: ${retryCountRef.current}`);
      }
      
      if (!trackedRef.current) {
        trackedRef.current = true;
        onViewTracked(video.id);
      }
    };

    const handleStalledEvent = () => {
      logEvent('stalled');
      if (!isPlaying && isActive) {
        retryCountRef.current++;
        
        // On 2nd retry, fallback to Supabase
        if (retryCountRef.current === 2 && sourceType === 'cloudinary') {
          console.warn(`[Fallback] Video ${index} switching to Supabase after Cloudinary failure`);
          logEvent('fallback', 'Switching to Supabase');
          setUseFallback(true);
          return;
        }
        
        if (retryCountRef.current < 4) {
          videoEl.load();
          videoEl.play().catch(() => {});
        } else {
          setPlaybackFailed(true);
        }
      }
    };

    const handleWaitingEvent = () => {
      logEvent('waiting');
      if (!stallTimeout && isActive && !isPlaying) {
        // Fast fallback - 1.5s for Cloudinary (likely transform delay), 3s for Supabase
        const timeout = sourceType === 'cloudinary' ? 1500 : 3000;
        stallTimeout = setTimeout(() => {
          console.warn(`[Timeout] Video ${index} stalled for ${timeout}ms`);
          logEvent('timeout', `${timeout}ms elapsed`);
          handleStalledEvent();
        }, timeout);
      }
    };

    const handleErrorEvent = () => {
      const error = videoEl.error;
      const errorMsg = error ? VIDEO_ERROR_CODES[error.code] || `Unknown error ${error.code}` : 'Unknown error';
      logEvent('error', errorMsg);
      setCurrentError(errorMsg);
      
      // On error, try fallback to Supabase on 2nd attempt
      retryCountRef.current++;
      if (retryCountRef.current === 2 && sourceType === 'cloudinary') {
        console.warn(`[Fallback] Video ${index} error, switching to Supabase`);
        setUseFallback(true);
      } else if (retryCountRef.current >= 4) {
        setPlaybackFailed(true);
      }
    };

    if (isActive && hasEntered) {
      setPlaybackFailed(false);
      setCurrentError(null);
      loadStartTimeRef.current = performance.now();
      srcAssignedTimeRef.current = performance.now();
      videoEl.currentTime = 0;
      isPlaying = false;
      
      logEvent('src_assigned', videoSrc.substring(0, 80) + '...');
      
      const attemptPlay = () => {
        // Only play if we have enough data
        if (videoEl.readyState >= 3) { // HAVE_FUTURE_DATA or better
          videoEl.play().catch((err) => {
            logEvent('play_error', err.name);
            if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
              return;
            }
            // Don't retry on AbortError - just wait for canplay
          });
        }
      };

      const handleCanPlay = () => {
        logEvent('canplay', `readyState: ${videoEl.readyState}`);
        clearStallTimeout();
        attemptPlay();
      };

      const handleLoadedMetadata = () => {
        logEvent('loadedmetadata', `duration: ${videoEl.duration?.toFixed(1)}s`);
      };

      const handleLoadStart = () => {
        logEvent('loadstart');
      };
      
      // Add all event listeners
      videoEl.addEventListener('loadstart', handleLoadStart);
      videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoEl.addEventListener('canplay', handleCanPlay);
      videoEl.addEventListener('playing', handlePlayingEvent);
      videoEl.addEventListener('stalled', handleStalledEvent);
      videoEl.addEventListener('waiting', handleWaitingEvent);
      videoEl.addEventListener('error', handleErrorEvent);
      
      // Start stall timeout - fast for Cloudinary (on-the-fly transforms are slow), longer for Supabase
      const initialTimeout = sourceType === 'cloudinary' ? 2000 : 4000;
      stallTimeout = setTimeout(() => {
        if (!isPlaying && videoEl.readyState < 3) {
          console.warn(`[Timeout] Video ${index} initial load timeout after ${initialTimeout}ms, readyState: ${videoEl.readyState}`);
          logEvent('initial_timeout', `readyState: ${videoEl.readyState}`);
          handleStalledEvent();
        }
      }, initialTimeout);

      // If already ready (cached), play immediately
      if (videoEl.readyState >= 3) {
        attemptPlay();
      }

      return () => {
        clearStallTimeout();
        videoEl.removeEventListener('loadstart', handleLoadStart);
        videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoEl.removeEventListener('canplay', handleCanPlay);
        videoEl.removeEventListener('playing', handlePlayingEvent);
        videoEl.removeEventListener('stalled', handleStalledEvent);
        videoEl.removeEventListener('waiting', handleWaitingEvent);
        videoEl.removeEventListener('error', handleErrorEvent);
      };
    } else {
      videoEl.pause();
    }
  }, [isActive, hasEntered, video.id, onViewTracked, index, videoSrc, sourceType, logEvent]);

  const handleRetry = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    
    retryCountRef.current++;
    setPlaybackFailed(false);
    setCurrentError(null);
    
    // If retrying after failure and was using Cloudinary, try Supabase
    if (sourceType === 'cloudinary' && retryCountRef.current >= 2) {
      setUseFallback(true);
    } else {
      videoEl.src = videoSrc;
      videoEl.load();
      videoEl.play().catch(() => {
        setPlaybackFailed(true);
      });
    }
  }, [videoSrc, sourceType]);

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
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover md:object-contain"
        style={{ paddingBottom: navOffset }}
        src={isActive || shouldPreload ? videoSrc : undefined}
        poster={posterSrc}
        loop
        playsInline
        muted={isMuted}
        preload={isActive ? "auto" : shouldPreload ? "metadata" : "none"}
        onClick={toggleMute}
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

      {/* Debug overlay - only in debug mode */}
      {isDebugMode() && isActive && (
        <div className="absolute top-4 left-4 right-16 z-50 pointer-events-none">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="pointer-events-auto mb-2 flex items-center gap-1 px-2 py-1 bg-black/80 rounded text-xs text-white"
          >
            <Bug className="h-3 w-3" />
            {showDebug ? 'Hide' : 'Debug'}
          </button>
          
          {showDebug && (
            <div className="pointer-events-auto bg-black/90 rounded-lg p-3 text-xs font-mono text-white max-h-[60vh] overflow-auto">
              <div className="space-y-2">
                <div>
                  <span className="text-gray-400">Source:</span>{' '}
                  <span className={sourceType === 'cloudinary' ? 'text-green-400' : 'text-yellow-400'}>
                    {sourceType.toUpperCase()}
                  </span>
                  {useFallback && <span className="text-red-400 ml-2">(FALLBACK)</span>}
                </div>
                
                <div className="break-all">
                  <span className="text-gray-400">URL:</span>{' '}
                  <span className="text-blue-300">{videoSrc.substring(0, 60)}...</span>
                </div>
                
                <div>
                  <span className="text-gray-400">Public ID:</span>{' '}
                  <span className="text-purple-300">{video.cloudinary_public_id || 'none'}</span>
                </div>
                
                <div>
                  <span className="text-gray-400">Retries:</span> {retryCountRef.current}
                </div>
                
                {currentError && (
                  <div className="text-red-400">
                    <span className="text-gray-400">Error:</span> {currentError}
                  </div>
                )}
                
                <div className="text-gray-400 mt-2">Events (last 10):</div>
                <div className="space-y-0.5 max-h-32 overflow-auto">
                  {debugEvents.map((ev, i) => (
                    <div key={i} className="text-gray-300">
                      <span className="text-gray-500">+{ev.time}ms</span>{' '}
                      <span className={ev.event.includes('error') ? 'text-red-400' : 'text-white'}>
                        {ev.event}
                      </span>
                      {ev.detail && <span className="text-gray-400"> - {ev.detail}</span>}
                    </div>
                  ))}
                </div>
                
                <button
                  onClick={copyDebugInfo}
                  className="mt-2 flex items-center gap-1 px-2 py-1 bg-white/20 rounded hover:bg-white/30"
                >
                  <Copy className="h-3 w-3" /> Copy Debug Info
                </button>
              </div>
            </div>
          )}
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

      <ShareDrawer videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />
    </div>
  );
});

FeedItem.displayName = 'FeedItem';