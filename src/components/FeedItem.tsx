import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2, Pencil, Volume2, VolumeX, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getThumbnailUrl, getOptimizedAvatarUrl } from "@/lib/cloudinary";
import { EditVideoDialog } from "./EditVideoDialog";
import { useWatchMetrics } from "@/hooks/use-watch-metrics";
import { activate as activateVideo, deactivateVideo, IS_IOS_WEB } from "@/lib/playbackController";
import { getGlobalMuted, setGlobalMuted, onMuteChange } from "@/lib/globalMute";
import { getGuestClientId, getGuestLikes, setGuestLikes } from "@/lib/guestLikes";
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
  hasEntered: boolean;
  currentUserId: string | null;
  feedSource?: string | null;
  onViewTracked: (videoId: string, watchDuration?: number) => void;
  onDelete?: (videoId: string) => void;
}

export const FeedItem = memo(({ 
  video, index, isActive, hasEntered, currentUserId, 
  feedSource = null, onViewTracked, onDelete,
}: FeedItemProps) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  

  const {
    markLoadStart, markStartupFailure, stopWatching, getMetrics,
  } = useWatchMetrics({
    videoId: video.id, userId: currentUserId, isActive, videoRef,
    videoIndex: index, feedSource,
    onViewRecorded: () => {
      const metrics = getMetrics();
      onViewTracked(video.id, metrics.watchDurationSeconds);
    },
  });
  
  // UI state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(getGlobalMuted());
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [localVideo, setLocalVideo] = useState(video);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Progress bar
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  
  // Double-tap
  const [doubleTapHearts, setDoubleTapHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const lastTapTimeRef = useRef<number>(0);
  const singleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const posterSrc = getThumbnailUrl(video.cloudflare_video_id, video.thumbnail_url);

  // Sync global mute
  useEffect(() => {
    return onMuteChange((muted) => {
      setIsMuted(muted);
      if (videoRef.current) videoRef.current.muted = muted;
    });
  }, []);

  /**
   * CORE PLAYBACK LIFECYCLE
   * 
   * Simple rules:
   * 1. Only active video gets an HLS source
   * 2. Wait for canplay, then play()
   * 3. On error, retry up to 2 times with full teardown
   * 4. On deactivation, fully release everything
   */
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (!isActive || !hasEntered) {
      deactivateVideo(videoEl);
      stopWatching();
      setIsPlaying(false);
      setPlaybackFailed(false);
      return;
    }

    setPlaybackFailed(false);
    setIsPlaying(false);
    markLoadStart();

    const cancel = activateVideo(videoEl, video.cloudflare_video_id, video.video_url, {
      onPlaying: () => {
        setIsPlaying(true);
        setPlaybackFailed(false);
      },
      onFailed: () => {
        markStartupFailure(10000);
        setPlaybackFailed(true);
      },
    });

    return () => {
      cancel();
      stopWatching();
    };
  }, [isActive, hasEntered, video.id]);

  const handleRetry = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    setPlaybackFailed(false);
    setIsPlaying(false);
    activateVideo(videoEl, video.cloudflare_video_id, video.video_url, {
      onPlaying: () => {
        setIsPlaying(true);
        setPlaybackFailed(false);
      },
      onFailed: () => setPlaybackFailed(true),
    });
  }, [video.cloudflare_video_id, video.video_url]);

  // Guest likes check
  useEffect(() => {
    if (!currentUserId) {
      setIsLiked(getGuestLikes().includes(video.id));
    }
  }, [video.id, currentUserId]);

  // Fetch user interaction states
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

  // Mute handlers
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
    const move = (ev: MouseEvent) => seekToPosition(ev.clientX);
    const up = () => { setIsScrubbing(false); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [seekToPosition]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsScrubbing(true);
    seekToPosition(e.touches[0].clientX);
    const move = (ev: TouchEvent) => seekToPosition(ev.touches[0].clientX);
    const end = () => { setIsScrubbing(false); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); };
    document.addEventListener('touchmove', move);
    document.addEventListener('touchend', end);
  }, [seekToPosition]);

  const toggleLike = useCallback(async () => {
    const clientId = getGuestClientId();
    const wasLiked = isLiked;
    setIsLiked(!wasLiked);
    setLikesCount(prev => wasLiked ? prev - 1 : prev + 1);
    try {
      const { data, error } = await supabase.functions.invoke('like-video', {
        body: { videoId: video.id, clientId: currentUserId || clientId, action: wasLiked ? 'unlike' : 'like' }
      });
      if (error) throw error;
      if (data?.likesCount !== undefined) setLikesCount(data.likesCount);
      if (!currentUserId) {
        const guestLikes = getGuestLikes();
        wasLiked ? setGuestLikes(guestLikes.filter(id => id !== video.id)) : setGuestLikes([...guestLikes, video.id]);
      }
    } catch {
      setIsLiked(wasLiked);
      setLikesCount(prev => wasLiked ? prev + 1 : prev - 1);
      toast.error("Failed to update like");
    }
  }, [isLiked, video.id, currentUserId]);

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
      if (!isLiked) toggleLike();
    } else {
      lastTapTimeRef.current = now;
      singleTapTimeoutRef.current = setTimeout(() => {
        unmute();
        singleTapTimeoutRef.current = null;
      }, 300);
    }
  }, [unmute, triggerHeartAnimation, isLiked, toggleLike]);

  const toggleSave = async () => {
    if (!currentUserId) { navigate("/auth"); return; }
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
    } catch { toast.error("Failed to save video"); }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || video.user_id !== currentUserId) return;
    try {
      await supabase.from("videos").delete().eq("id", video.id);
      toast.success("Video deleted");
      onDelete?.(video.id);
    } catch { toast.error("Failed to delete video"); }
  };

  const handleCategoryClick = (tag: string) => {
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => navigate(`/profile/${video.user_id}`);

  const isOwnVideo = currentUserId === video.user_id;
  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  return (
    <div className="relative w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always" data-video-index={index}>
      <div className="absolute inset-0 flex items-center justify-center bg-black" style={{ paddingBottom: navOffset }}>
        <div className="relative overflow-hidden bg-black" style={{ width: `min(100%, calc((100dvh - ${navOffset}) * 9 / 16))`, aspectRatio: "9 / 16" }}>
          {/* Poster — same object-contain as video so framing matches */}
          <img src={posterSrc} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-black" />

          {/* Video — fades in over poster when playing */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain bg-black"
            loop playsInline
            // @ts-ignore
            webkit-playsinline="true" x5-playsinline="true" x5-video-player-type="h5" x5-video-player-fullscreen="false"
            muted={isMuted}
            preload="none"
            style={{ opacity: isPlaying ? 1 : 0, transition: 'opacity 150ms ease' }}
            onClick={handleVideoTap}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
          />
        </div>
      </div>

      {/* Double-tap hearts */}
      {doubleTapHearts.map(heart => (
        <div key={heart.id} className="absolute pointer-events-none z-30" style={{ left: heart.x - 40, top: heart.y - 40 }}>
          <Heart className="h-20 w-20 fill-primary text-primary animate-double-tap-heart" style={{ filter: 'drop-shadow(0 0 10px rgba(255, 200, 0, 0.5))' }} />
        </div>
      ))}

      {/* Playback failed */}
      {playbackFailed && isActive && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/30 pointer-events-none">
          <button onClick={handleRetry} className="flex flex-col items-center gap-2 p-4 bg-black/60 rounded-xl backdrop-blur-sm pointer-events-auto">
            <RefreshCw className="h-8 w-8 text-white" />
            <span className="text-white text-sm">Tap to retry</span>
          </button>
        </div>
      )}

      {/* Mute indicator */}
      {showMuteIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isMuted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Right side actions */}
      <div className="absolute right-4 flex flex-col items-center gap-5 z-40" style={{ bottom: navOffset, paddingBottom: '140px' }}>
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
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setIsEditOpen(true); }} className="cursor-pointer">
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive cursor-pointer">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Bottom info */}
      <div className="absolute left-0 right-0 p-4 z-40 bg-gradient-to-t from-black via-black/60 to-transparent pr-[80px]" style={{ bottom: navOffset }}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit" onClick={handleProfileClick}>
            <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden border-2 border-primary flex-shrink-0">
              {video.profiles.avatar_url ? (
                <img src={getOptimizedAvatarUrl(video.profiles.avatar_url, 80)} alt={video.profiles.username} className="w-full h-full object-cover" loading="lazy" decoding="async"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
              ) : null}
              <div className={`w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold ${video.profiles.avatar_url ? 'hidden' : ''}`}>
                {video.profiles.username[0]?.toUpperCase() || '?'}
              </div>
            </div>
            <span className="text-white font-semibold">@{video.profiles.username}</span>
          </div>
          {localVideo.description && <p className="text-white/90 text-sm">{localVideo.description}</p>}
          {localVideo.tags && localVideo.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {localVideo.tags.map((tag, idx) => (
                <button key={idx} onClick={(e) => { e.stopPropagation(); handleCategoryClick(tag); }} className="text-primary text-sm font-semibold hover:underline cursor-pointer">#{tag}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShareDrawer videoId={video.id} videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />

      {/* Progress bar */}
      {isActive && (
        <div ref={progressBarRef} className="absolute left-0 right-0 h-6 z-[60] cursor-pointer group" style={{ bottom: navOffset }}
          onMouseDown={handleProgressMouseDown} onTouchStart={handleProgressTouchStart}>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30 transition-all group-hover:h-1.5 group-active:h-1.5">
            <div className="absolute inset-y-0 left-0 bg-primary rounded-r-full" style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : '0%' }} />
            {duration > 0 && (
              <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-lg transition-transform opacity-0 group-hover:opacity-100 group-active:opacity-100 group-active:scale-125"
                style={{ left: `calc(${(progress / duration) * 100}% - 8px)` }} />
            )}
          </div>
        </div>
      )}

      <EditVideoDialog open={isEditOpen} onOpenChange={setIsEditOpen} videoId={video.id}
        initialDescription={localVideo.description} initialTags={localVideo.tags}
        onSaved={(desc, tags) => setLocalVideo(prev => ({ ...prev, description: desc, tags }))} />
    </div>
  );
});

FeedItem.displayName = 'FeedItem';
