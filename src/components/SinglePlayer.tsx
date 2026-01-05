import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Loader2, RefreshCw, Play, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";

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
  hasEntered: boolean;
  onViewTracked: (videoId: string) => void;
}

const MAX_RETRY_ATTEMPTS = 3;
const LOAD_TIMEOUT_MS = 8000;

export const SinglePlayer = memo(({ 
  video, 
  hasEntered,
  onViewTracked 
}: SinglePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const trackedViewsRef = useRef<Set<string>>(new Set());
  const attemptRef = useRef(0);
  
  const [status, setStatus] = useState<VideoStatus>("idle");
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // Compute video source - stable policy: optimized_video_url if exists, else video_url
  const videoSrc = video ? getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    null,
    video.video_url
  ) : "";
  const fallbackSrc = video?.video_url || "";
  const posterSrc = video ? getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url) : "";

  // Track current src for fallback logic
  const [currentSrc, setCurrentSrc] = useState(videoSrc);
  const [usedFallback, setUsedFallback] = useState(false);

  // Clear timeout helper
  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Retry logic - fall back to Supabase storage if Cloudinary fails
  const retryOrFallback = useCallback(() => {
    clearLoadTimeout();
    const videoEl = videoRef.current;
    if (!videoEl || !video) return;

    attemptRef.current++;
    console.log(`[SinglePlayer] Retry attempt ${attemptRef.current} for video ${video.id}, usedFallback=${usedFallback}`);
    
    // Check if current src is a Cloudinary URL
    const isCloudinaryUrl = currentSrc?.includes('cloudinary.com') || currentSrc?.includes('res.cloudinary.com');
    
    if (!usedFallback && isCloudinaryUrl && fallbackSrc && fallbackSrc !== currentSrc) {
      // Cloudinary failed - immediately try Supabase storage
      console.log(`[SinglePlayer] Cloudinary failed, falling back to Supabase: ${fallbackSrc.substring(0, 60)}...`);
      setUsedFallback(true);
      setCurrentSrc(fallbackSrc);
      videoEl.src = fallbackSrc;
      videoEl.load();
      setStatus("loading");
      
      timeoutRef.current = setTimeout(() => {
        console.log(`[SinglePlayer] Fallback load timeout`);
        retryOrFallback();
      }, LOAD_TIMEOUT_MS);
      return;
    }
    
    if (attemptRef.current >= MAX_RETRY_ATTEMPTS) {
      console.log(`[SinglePlayer] All retries exhausted for video ${video.id}`);
      setStatus("error");
      return;
    }

    // Add cache buster and reload
    const srcToUse = usedFallback ? fallbackSrc : videoSrc;
    const cacheBuster = srcToUse.includes("?") ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
    const newSrc = srcToUse + cacheBuster;
    setCurrentSrc(newSrc);
    videoEl.src = newSrc;
    videoEl.load();
    setStatus("loading");
    
    // Set timeout for this attempt
    timeoutRef.current = setTimeout(() => {
      console.log(`[SinglePlayer] Load timeout after ${LOAD_TIMEOUT_MS}ms`);
      retryOrFallback();
    }, LOAD_TIMEOUT_MS);
  }, [video, videoSrc, fallbackSrc, currentSrc, usedFallback, clearLoadTimeout]);

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
    const videoEl = videoRef.current;
    if (!videoEl) return;
    
    if (video?.id !== currentVideoId) {
      console.log(`[SinglePlayer] Video changed: ${currentVideoId} -> ${video?.id}`);
      setCurrentVideoId(video?.id || null);
      attemptRef.current = 0;
      setUsedFallback(false);
      clearLoadTimeout();
      
      if (video && videoSrc) {
        setCurrentSrc(videoSrc);
        videoEl.pause();
        videoEl.src = videoSrc;
        setStatus("loading");
        videoEl.load();
        
        // Set timeout for initial load
        timeoutRef.current = setTimeout(() => {
          console.log(`[SinglePlayer] Initial load timeout`);
          retryOrFallback();
        }, LOAD_TIMEOUT_MS);
      } else {
        videoEl.pause();
        videoEl.src = "";
        setCurrentSrc("");
        setStatus("idle");
      }
    }
  }, [video?.id, videoSrc, currentVideoId, clearLoadTimeout, retryOrFallback]);

  // Handle playback based on hasEntered and status
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video) return;

    if (status === "ready" && hasEntered) {
      console.log(`[SinglePlayer] Attempting to play video ${video.id}`);
      videoEl.currentTime = 0;
      const playPromise = videoEl.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(`[SinglePlayer] Playing video ${video.id}`);
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
    } else if (!hasEntered || status !== "ready") {
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
    console.log(`[SinglePlayer] canplay - video ready`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout]);

  const handlePlaying = useCallback(() => {
    console.log(`[SinglePlayer] playing`);
    clearLoadTimeout();
    if (status !== "ready") {
      setStatus("ready");
    }
  }, [clearLoadTimeout, status]);

  const handleError = useCallback(() => {
    const videoEl = videoRef.current;
    console.error(`[SinglePlayer] error:`, videoEl?.error?.message, videoEl?.error?.code);
    clearLoadTimeout();
    retryOrFallback();
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
    console.log(`[SinglePlayer] Manual retry requested`);
    attemptRef.current = 0;
    setUsedFallback(false);
    setStatus("loading");
    
    const videoEl = videoRef.current;
    if (videoEl && videoSrc) {
      setCurrentSrc(videoSrc);
      videoEl.pause();
      videoEl.src = videoSrc;
      videoEl.load();
      
      timeoutRef.current = setTimeout(() => {
        retryOrFallback();
      }, LOAD_TIMEOUT_MS);
    }
  }, [videoSrc, retryOrFallback]);

  // Don't render if no video
  if (!video) return null;

  const showLoading = status === "loading";
  const showError = status === "error";
  const showTapToPlay = status === "needsInteraction";

  return (
    <div 
      className="fixed inset-0 z-10 pointer-events-none"
      style={{ 
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* Video element with poster for instant display */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover md:object-contain pointer-events-none bg-black"
        loop
        playsInline
        muted={isMuted}
        preload="auto"
        poster={posterSrc || undefined}
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        onError={handleError}
      />
      
      {/* Tap area for mute toggle - pointer-events-auto only here */}
      <div 
        className="absolute inset-0 z-10 pointer-events-auto"
        onClick={handleVideoTap}
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
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50 pointer-events-auto">
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
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-auto">
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