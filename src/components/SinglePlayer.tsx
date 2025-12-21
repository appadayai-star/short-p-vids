import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Loader2, RefreshCw, Play, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSourceWithDebug, getBestThumbnailUrl, VideoSourceResult } from "@/lib/cloudinary";

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
  
  const [status, setStatus] = useState<VideoStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // Debug mode state
  const isDebugMode = typeof window !== 'undefined' && localStorage.getItem('videoDebug') === '1';
  const [ttffMs, setTtffMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const loadStartRef = useRef<number>(0);

  // Compute video sources with debug info
  const videoSourceResult: VideoSourceResult = video ? getBestVideoSourceWithDebug(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    null,
    video.video_url
  ) : { url: '', sourceHost: 'supabase', isFallback: true };
  const primarySrc = videoSourceResult.url;
  
  const lastResortSrc = video?.video_url || "";
  const posterSrc = video ? getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url) : "";

  const [src, setSrc] = useState(primarySrc);
  const [currentSourceHost, setCurrentSourceHost] = useState(videoSourceResult.sourceHost);

  // Clear timeout helper
  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Retry or fallback logic - immediately fall back to Supabase on Cloudinary failure
  const retryOrFallback = useCallback((reason: "error" | "timeout", errorInfo?: string) => {
    clearLoadTimeout();
    const errorMsg = errorInfo || reason;
    setLastError(errorMsg);
    console.log(`[SinglePlayer] retryOrFallback: reason=${errorMsg}, attempt=${attempt}`);
    
    // If we're on Cloudinary and it failed, immediately try Supabase
    if (attempt === 0 && videoSourceResult.sourceHost !== 'supabase') {
      console.log(`[SinglePlayer] Cloudinary failed, falling back to Supabase`);
      setAttempt(1);
      setSrc(lastResortSrc);
      setCurrentSourceHost('supabase');
      setStatus("loading");
    } else if (attempt === 1) {
      // Supabase failed too, try with cache buster
      console.log(`[SinglePlayer] Retrying Supabase with cache buster`);
      setAttempt(2);
      const cacheBuster = lastResortSrc.includes("?") ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
      setSrc(lastResortSrc + cacheBuster);
      setStatus("loading");
    } else {
      console.log(`[SinglePlayer] All retries exhausted`);
      setStatus("error");
    }
  }, [attempt, videoSourceResult.sourceHost, lastResortSrc, clearLoadTimeout]);

  // Start loading timeout watchdog
  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      console.log(`[SinglePlayer] Load timeout triggered after ${LOAD_TIMEOUT_MS}ms`);
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
    const videoEl = videoRef.current;
    if (!videoEl) return;
    
    if (video?.id !== currentVideoId) {
      console.log(`[SinglePlayer] Video changed: ${currentVideoId} -> ${video?.id}`);
      setCurrentVideoId(video?.id || null);
      setAttempt(0);
      clearLoadTimeout();
      
      if (video) {
        loadStartRef.current = performance.now();
        setTtffMs(null);
        videoEl.pause();
        videoEl.src = primarySrc;
        setSrc(primarySrc);
        setStatus("loading");
        videoEl.load();
        startLoadTimeout();
      } else {
        videoEl.pause();
        videoEl.src = "";
        setStatus("idle");
      }
    }
  }, [video?.id, primarySrc, currentVideoId, startLoadTimeout, clearLoadTimeout]);

  // Handle src changes for retries
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video || status !== "loading" || attempt === 0) return;
    
    console.log(`[SinglePlayer] Retry attempt ${attempt}, src: ${src.substring(0, 50)}...`);
    videoEl.pause();
    videoEl.src = src;
    videoEl.load();
    startLoadTimeout();
  }, [src, attempt, status, video, startLoadTimeout]);

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
  const handleLoadedMetadata = useCallback(() => {
    console.log(`[SinglePlayer] loadedmetadata`);
  }, []);

  const handleCanPlay = useCallback(() => {
    const elapsed = loadStartRef.current ? Math.round(performance.now() - loadStartRef.current) : null;
    if (elapsed) setTtffMs(elapsed);
    console.log(`[SinglePlayer] canplay - TTFF: ${elapsed}ms, src: ${videoSourceResult.sourceHost}`);
    clearLoadTimeout();
    setStatus("ready");
  }, [clearLoadTimeout, videoSourceResult.sourceHost]);

  const handlePlaying = useCallback(() => {
    console.log(`[SinglePlayer] playing`);
    clearLoadTimeout();
    if (status !== "ready") {
      setStatus("ready");
    }
  }, [clearLoadTimeout, status]);

  const handleWaiting = useCallback(() => {
    console.log(`[SinglePlayer] waiting (buffering)`);
  }, []);

  const handleStalled = useCallback(() => {
    console.log(`[SinglePlayer] stalled - network issue`);
  }, []);

  const handleError = useCallback(() => {
    const videoEl = videoRef.current;
    const error = videoEl?.error;
    const mediaErrCode = error?.code;
    const mediaErrName = mediaErrCode === 1 ? 'ABORTED' : 
                         mediaErrCode === 2 ? 'NETWORK' : 
                         mediaErrCode === 3 ? 'DECODE' : 
                         mediaErrCode === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN';
    const errorInfo = `MEDIA_ERR_${mediaErrName}(${mediaErrCode}): ${error?.message || 'no message'}`;
    console.error(`[SinglePlayer] error:`, errorInfo);
    clearLoadTimeout();
    retryOrFallback("error", errorInfo);
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
    setAttempt(0);
    setSrc(primarySrc);
    setStatus("loading");
    
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.pause();
      videoEl.src = primarySrc;
      videoEl.load();
      startLoadTimeout();
    }
  }, [primarySrc, startLoadTimeout]);

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
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        onWaiting={handleWaiting}
        onStalled={handleStalled}
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

      {/* Debug overlay - shows when localStorage.videoDebug = '1' */}
      {isDebugMode && (
        <div className="absolute top-20 left-4 z-30 bg-black/90 text-white text-xs font-mono p-2 rounded max-w-[220px] pointer-events-none space-y-0.5">
          <div>Host: <span className={currentSourceHost === 'supabase' ? 'text-yellow-400' : 'text-green-400'}>{currentSourceHost}</span></div>
          <div>TTFF: {ttffMs !== null ? `${ttffMs}ms` : '...'}</div>
          <div>Status: {status} | Attempt: {attempt}</div>
          <div className="truncate text-[10px]">Src: {src?.substring(0, 50)}...</div>
          {lastError && <div className="text-red-400 text-[10px] break-words">{lastError}</div>}
          {videoSourceResult.reason && <div className="text-blue-300 text-[10px]">{videoSourceResult.reason}</div>}
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
