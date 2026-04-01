import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, Volume2, VolumeX, MoreVertical, Trash2, Pencil, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getThumbnailUrl, getOptimizedAvatarUrl } from "@/lib/cloudinary";
import { useHlsPlayer } from "@/hooks/use-hls-player";
import { useWatchMetrics } from "@/hooks/use-watch-metrics";
import { getGlobalMuted, setGlobalMuted, onMuteChange } from "@/lib/globalMute";
import { getGuestClientId, getGuestLikes, setGuestLikes } from "@/lib/guestLikes";
import { ShareDrawer } from "./ShareDrawer";
import { EditVideoDialog } from "./EditVideoDialog";
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
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  cloudflare_video_id?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  user_id: string;
  tags: string[] | null;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface ModalVideoItemProps {
  video: Video;
  index: number;
  isActive: boolean;
  shouldPreload: boolean;
  shouldPreloadMeta: boolean;
  currentUserId: string | null;
  isLiked: boolean;
  isSaved: boolean;
  likesCount: number;
  savesCount: number;
  onToggleLike: (videoId: string) => void;
  onToggleSave: (videoId: string) => void;
  onDelete: (videoId: string) => void;
  onClose: () => void;
  onVideoUpdated?: (videoId: string, desc: string | null, tags: string[] | null) => void;
}

export const ModalVideoItem = memo(({
  video,
  index,
  isActive,
  shouldPreload,
  shouldPreloadMeta,
  currentUserId,
  isLiked,
  isSaved,
  likesCount,
  savesCount,
  onToggleLike,
  onToggleSave,
  onDelete,
  onClose,
  onVideoUpdated,
}: ModalVideoItemProps) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryCountRef = useRef(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Watch metrics
  const {
    markLoadStart,
    markStartupFailure,
    stopWatching,
  } = useWatchMetrics({
    videoId: video.id,
    userId: currentUserId,
    isActive,
    videoRef,
    videoIndex: index,
    feedSource: 'modal',
  });

  // UI state
  const [isMuted, setIsMuted] = useState(getGlobalMuted());
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [localVideo, setLocalVideo] = useState(video);

  // Progress bar state
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Double-tap like state
  const [doubleTapHearts, setDoubleTapHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const lastTapTimeRef = useRef<number>(0);
  const singleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { attachSource, detachSource } = useHlsPlayer({
    cloudflareVideoId: video.cloudflare_video_id,
    fallbackUrl: video.video_url,
  });

  const posterSrc = getThumbnailUrl(video.cloudflare_video_id, video.thumbnail_url);

  // Sync global mute
  useEffect(() => {
    return onMuteChange((muted) => {
      setIsMuted(muted);
      if (videoRef.current) videoRef.current.muted = muted;
    });
  }, []);

  // Unified source + playback lifecycle — only ACTIVE video gets HLS instance
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const id = ++seqRef.current;
    const isStale = () => id !== seqRef.current;

    // === NOT ACTIVE — fully release all resources ===
    if (!isActive) {
      stopWatching();
      detachSource(videoEl);
      setHasStartedPlaying(false);
      setPlaybackFailed(false);
      return () => { seqRef.current++; };
    }

    // === ACTIVE ===
    setPlaybackFailed(false);
    setHasStartedPlaying(false);
    retryCountRef.current = 0;
    markLoadStart();

    attachSource(videoEl);
    videoEl.currentTime = 0;

    const clearFail = () => {
      if (isStale()) return;
      setPlaybackFailed(false);
      setHasStartedPlaying(true);
    };

    const attemptPlay = () => {
      if (isStale()) return;
      videoEl.play().catch((err) => {
        if (isStale()) return;
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        retryCountRef.current += 1;
        if (retryCountRef.current <= 3) {
          setTimeout(() => {
            if (isStale()) return;
            detachSource(videoEl);
            attachSource(videoEl);
            attemptPlay();
          }, 300 * retryCountRef.current);
          return;
        }
        markStartupFailure(10000);
        setPlaybackFailed(true);
      });
    };

    const handleError = () => {
      if (isStale()) return;
      if (!videoEl.paused && videoEl.currentTime > 0) return;
      retryCountRef.current += 1;
      if (retryCountRef.current <= 3) {
        setTimeout(() => {
          if (isStale()) return;
          detachSource(videoEl);
          attachSource(videoEl);
          attemptPlay();
        }, 300 * retryCountRef.current);
        return;
      }
      markStartupFailure(10000);
      setPlaybackFailed(true);
    };

    // Detect dead first-frame state
    let stuckCheckTimer: ReturnType<typeof setTimeout> | null = null;
    const handlePlaying = () => {
      if (isStale()) return;
      clearFail();
      stuckCheckTimer = setTimeout(() => {
        if (isStale()) return;
        if (videoEl && !videoEl.paused && videoEl.currentTime === 0) {
          retryCountRef.current += 1;
          if (retryCountRef.current <= 3) {
            detachSource(videoEl);
            attachSource(videoEl);
            attemptPlay();
          } else {
            setPlaybackFailed(true);
          }
        }
      }, 1500);
    };

    videoEl.addEventListener('loadeddata', clearFail);
    videoEl.addEventListener('canplay', clearFail);
    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('error', handleError);

    attemptPlay();

    return () => {
      seqRef.current++;
      if (stuckCheckTimer) clearTimeout(stuckCheckTimer);
      videoEl.removeEventListener('loadeddata', clearFail);
      videoEl.removeEventListener('canplay', clearFail);
      videoEl.removeEventListener('playing', handlePlaying);
      videoEl.removeEventListener('error', handleError);
      stopWatching();
      detachSource(videoEl);
    };
  }, [isActive, markLoadStart, markStartupFailure, stopWatching, attachSource, detachSource]);

  const handleRetry = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    retryCountRef.current = 0;
    setPlaybackFailed(false);
    detachSource(videoEl);
    attachSource(videoEl);
    videoEl.play().catch(() => {});
  }, [attachSource, detachSource]);

  // Tap handlers
  const unmute = useCallback(() => {
    if (isMuted) {
      setGlobalMuted(false);
      setShowMuteIcon(true);
      setTimeout(() => setShowMuteIcon(false), 500);
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setGlobalMuted(!isMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  const triggerHeartAnimation = useCallback((x: number, y: number) => {
    const heartId = Date.now();
    setDoubleTapHearts(prev => [...prev, { id: heartId, x, y }]);
    setTimeout(() => setDoubleTapHearts(prev => prev.filter(h => h.id !== heartId)), 1000);
  }, []);

  const handleVideoTap = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    e.preventDefault();
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (singleTapTimeoutRef.current) {
      clearTimeout(singleTapTimeoutRef.current);
      singleTapTimeoutRef.current = null;
    }

    if (timeSinceLastTap > 50 && timeSinceLastTap < 300) {
      lastTapTimeRef.current = 0;
      triggerHeartAnimation(x, y);
      if (!isLiked) onToggleLike(video.id);
    } else {
      lastTapTimeRef.current = now;
      singleTapTimeoutRef.current = setTimeout(() => {
        unmute();
        singleTapTimeoutRef.current = null;
      }, 300);
    }
  }, [unmute, triggerHeartAnimation, isLiked, onToggleLike, video.id]);

  // Progress bar
  const handleTimeUpdate = useCallback(() => {
    const videoEl = videoRef.current;
    if (videoEl && !isScrubbing) {
      setProgress(videoEl.currentTime);
      setDuration(videoEl.duration || 0);
    }
  }, [isScrubbing]);

  const handleLoadedMetadata = useCallback(() => {
    const videoEl = videoRef.current;
    if (videoEl) setDuration(videoEl.duration || 0);
  }, []);

  const seekToPosition = useCallback((clientX: number) => {
    const bar = progressBarRef.current;
    const videoEl = videoRef.current;
    if (!bar || !videoEl || !duration) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const newTime = (x / rect.width) * duration;
    videoEl.currentTime = newTime;
    setProgress(newTime);
  }, [duration]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsScrubbing(true);
    seekToPosition(e.clientX);
    const handleMouseMove = (moveEvent: MouseEvent) => seekToPosition(moveEvent.clientX);
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
    const handleTouchMove = (moveEvent: TouchEvent) => seekToPosition(moveEvent.touches[0].clientX);
    const handleTouchEnd = () => {
      setIsScrubbing(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  }, [seekToPosition]);

  const handleProfileClick = () => {
    onClose();
    navigate(`/profile/${video.user_id}`);
  };

  const handleCategoryClick = (tag: string) => {
    onClose();
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const isOwnVideo = currentUserId === video.user_id;
  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  return (
    <div className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center">
      {/* Poster — always visible, video fades over it */}
      {posterSrc && (
        <img
          src={posterSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none"
          style={{ paddingBottom: navOffset }}
        />
      )}

      {/* Video element — HLS managed by useHlsPlayer */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        style={{
          paddingBottom: navOffset,
          opacity: isActive && hasStartedPlaying ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
        loop
        muted={isMuted}
        playsInline
        // @ts-ignore
        webkit-playsinline="true"
        x5-playsinline="true"
        x5-video-player-type="h5"
        x5-video-player-fullscreen="false"
        preload={isActive || shouldPreload ? "auto" : shouldPreloadMeta ? "metadata" : "none"}
        onClick={handleVideoTap}
        onTimeUpdate={isActive ? handleTimeUpdate : undefined}
        onLoadedMetadata={isActive ? handleLoadedMetadata : undefined}
      />

      {/* Playback failed — retry */}
      {playbackFailed && isActive && (
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

      {/* Double-tap hearts */}
      {isActive && doubleTapHearts.map(heart => (
        <div
          key={heart.id}
          className="absolute pointer-events-none z-30"
          style={{ left: heart.x - 40, top: heart.y - 40 }}
        >
          <Heart
            className="h-20 w-20 fill-primary text-primary animate-double-tap-heart"
            style={{ filter: 'drop-shadow(0 0 10px rgba(255, 200, 0, 0.5))' }}
          />
        </div>
      ))}

      {/* Mute indicator flash */}
      {showMuteIcon && isActive && (
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
        <button onClick={() => onToggleLike(video.id)} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-6 w-6", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">{likesCount}</span>
        </button>

        <button onClick={() => onToggleSave(video.id)} className="flex flex-col items-center gap-1">
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
              <DropdownMenuItem onClick={() => setIsEditOpen(true)} className="cursor-pointer">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(video.id)} className="text-destructive focus:text-destructive cursor-pointer">
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
        style={{ bottom: navOffset }}
      >
        <div className="space-y-2">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit"
            onClick={handleProfileClick}
          >
            <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden border-2 border-primary flex-shrink-0">
              {video.profiles?.avatar_url ? (
                <img
                  src={getOptimizedAvatarUrl(video.profiles.avatar_url, 80)}
                  alt={video.profiles.username}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                  {video.profiles?.username?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </div>
            <span className="text-white font-semibold">@{video.profiles?.username}</span>
          </div>

          {localVideo.description && <p className="text-white/90 text-sm">{localVideo.description}</p>}

          {localVideo.tags && localVideo.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {localVideo.tags.map((tag, i) => (
                <button
                  key={i}
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

      <ShareDrawer videoId={video.id} videoTitle={video.title} username={video.profiles?.username || 'unknown'} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />

      {/* Progress bar */}
      {isActive && (
        <div
          ref={progressBarRef}
          className="absolute left-0 right-0 h-6 z-[60] cursor-pointer group"
          style={{ bottom: navOffset }}
          onMouseDown={handleProgressMouseDown}
          onTouchStart={handleProgressTouchStart}
        >
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30 transition-all group-hover:h-1.5 group-active:h-1.5">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-r-full"
              style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : '0%' }}
            />
            {duration > 0 && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-lg transition-transform opacity-0 group-hover:opacity-100 group-active:opacity-100 group-active:scale-125"
                style={{ left: `calc(${(progress / duration) * 100}% - 8px)` }}
              />
            )}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <EditVideoDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        videoId={video.id}
        initialDescription={localVideo.description}
        initialTags={localVideo.tags}
        onSaved={(desc, tags) => {
          setLocalVideo(prev => ({ ...prev, description: desc, tags }));
          onVideoUpdated?.(video.id, desc, tags);
        }}
      />
    </div>
  );
});

ModalVideoItem.displayName = 'ModalVideoItem';
