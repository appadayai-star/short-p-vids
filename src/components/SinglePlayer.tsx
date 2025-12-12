import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Loader2, RefreshCw, Play, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";

// Global mute state - persisted across videos
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();

const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(listener => listener(muted));
};

export const getGlobalMuted = () => globalMuted;

interface Video {
  id: string;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
}

type VideoStatus = "idle" | "loading" | "ready" | "error" | "needsInteraction";

interface SinglePlayerProps {
  video: Video | null;
  containerRect: DOMRect | null;
  hasEntered: boolean;
  onViewTracked: (videoId: string) => void;
}

const MAX_RETRY_ATTEMPTS = 3;
const LOAD_TIMEOUT_MS = 5000;

export const SinglePlayer = memo(({ 
  video, 
  containerRect, 
  hasEntered,
  onViewTracked 
}: SinglePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const trackedViewsRef = useRef<Set<string>>(new Set());
  
  const [status, setStatus] = useState<VideoStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // Compute video sources
  const primarySrc = video ? getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    video.stream_url || null,
    video.video_url
  ) : "";
  
  const fallbackSrc = video?.optimized_video_url || video?.video_url || "";
  const lastResortSrc = video?.video_url || "";
  const posterSrc = video ? getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url) : "";

  const [src, setSrc] = useState(primarySrc);

  // Clear timeout helper
  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Retry or fallback logic
  const retryOrFallback = useCallback((reason: "error" | "timeout") => {
    clearLoadTimeout();
    console.log(`[SinglePlayer] retryOrFallback: reason=${reason}, attempt=${attempt}`);
    
    if (attempt === 0) {
      setAttempt(1);
      const cacheBuster = primarySrc.includes("?") ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
      setSrc(primarySrc + cacheBuster);
      setStatus("loading");
    } else if (attempt === 1 && fallbackSrc && fallbackSrc !== primarySrc) {
      console.log(`[SinglePlayer] Trying fallback`);
      setAttempt(2);
      setSrc(fallbackSrc);
      setStatus("loading");
    } else if (attempt <= 2 && lastResortSrc && lastResortSrc !== fallbackSrc && lastResortSrc !== primarySrc) {
      console.log(`[SinglePlayer] Trying lastResort`);
      setAttempt(3);
      setSrc(lastResortSrc);
      setStatus("loading");
    } else {
      console.log(`[SinglePlayer] All retries exhausted`);
      setStatus("error");
    }
  }, [attempt, primarySrc, fallbackSrc, lastResortSrc, clearLoadTimeout]);

  // Start loading timeout watchdog
  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      console.log(`[SinglePlayer] Load timeout triggered`);
      retryOrFallback("timeout");
    }, LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout, retryOrFallback]);

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

  // Reset when video changes
  useEffect(() => {
    if (video?.id !== currentVideoId) {
      setCurrentVideoId(video?.id || null);
      setAttempt(0);
      setSrc(primarySrc);
      setStatus(video ? "loading" : "idle");
      
      if (videoRef.current && video) {
        videoRef.current.src = primarySrc;
        videoRef.current.load();
        startLoadTimeout();
      }
    }
  }, [video?.id, primarySrc, currentVideoId, startLoadTimeout]);

  // Handle src changes for retries
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video || status !== "loading" || attempt === 0) return;
    
    videoEl.src = src;
    videoEl.load();
    startLoadTimeout();
  }, [src, attempt, status, video, startLoadTimeout]);

  // Handle playback based on hasEntered
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video) return;

    if (status === "ready" && hasEntered) {
      videoEl.currentTime = 0;
      const playPromise = videoEl.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Track view once per video
            if (!trackedViewsRef.current.has(video.id)) {
              trackedViewsRef.current.add(video.id);
              onViewTracked(video.id);
            }
          })
          .catch((error) => {
            console.log(`[SinglePlayer] play() rejected:`, error.name);
            if (error.name === "NotAllowedError") {
              setStatus("needsInteraction");
            }
          });
      }
    } else {
      videoEl.pause();
    }
  }, [status, hasEntered, video, onViewTracked]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLoadTimeout();
    };
  }, [clearLoadTimeout]);

  // Video event handlers
  const handleCanPlay = useCallback(() => {
    console.log(`[SinglePlayer] canplay`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout]);

  const handlePlaying = useCallback(() => {
    console.log(`[SinglePlayer] playing`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout]);

  const handleError = useCallback(() => {
    const videoEl = videoRef.current;
    console.error(`[SinglePlayer] error:`, videoEl?.error?.message);
    clearLoadTimeout();
    retryOrFallback("error");
  }, [clearLoadTimeout, retryOrFallback]);

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
        }).catch(() => {});
      }
    } else {
      toggleMute();
    }
  }, [status, toggleMute]);

  const handleRetry = useCallback(() => {
    console.log(`[SinglePlayer] Manual retry`);
    setAttempt(0);
    setSrc(primarySrc);
    setStatus("loading");
  }, [primarySrc]);

  // Don't render if no video or no position
  if (!video || !containerRect) return null;

  const showLoading = status === "loading";
  const showError = status === "error";
  const showTapToPlay = status === "needsInteraction";

  return (
    <div 
      className="fixed z-30 pointer-events-auto"
      style={{
        top: containerRect.top,
        left: containerRect.left,
        width: containerRect.width,
        height: containerRect.height,
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black"
        loop
        playsInline
        muted={isMuted}
        preload="auto"
        poster={posterSrc}
        onClick={handleVideoTap}
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        onWaiting={() => console.log('[SinglePlayer] waiting')}
        onStalled={() => console.log('[SinglePlayer] stalled')}
        onError={handleError}
      />

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

      {/* Tap to play overlay */}
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

      {/* Mute/Unmute indicator (center flash) */}
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
    </div>
  );
});

SinglePlayer.displayName = 'SinglePlayer';
