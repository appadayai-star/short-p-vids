import { memo, useRef, useEffect, useState, useCallback } from "react";
import { RefreshCw, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSource, getBestThumbnailUrl, checkVideoUrlStatus } from "@/lib/cloudinary";
import { DebugOverlay, DebugEvent, DebugMetrics } from "./DebugOverlay";

// Global mute state - persisted across videos
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();

export const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(listener => listener(muted));
};

export const getGlobalMuted = () => globalMuted;

const isDebugMode = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('debug');
};

interface Video {
  id: string;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
}

interface SinglePlayerProps {
  video: Video | null;
  activeIndex: number;
  isScrolling: boolean;
  abortedPrefetches: number;
  onPlaybackStarted: () => void;
}

export const SinglePlayer = memo(({ 
  video, 
  activeIndex,
  isScrolling,
  abortedPrefetches,
  onPlaybackStarted,
}: SinglePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadStartRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Debug metrics
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [headCheckStatus, setHeadCheckStatus] = useState<number | null>(null);
  const [timeToMetadata, setTimeToMetadata] = useState<number | null>(null);
  const [timeToPlaying, setTimeToPlaying] = useState<number | null>(null);

  // Get video sources
  const { url: videoSrc, type: sourceType } = video 
    ? getBestVideoSource(
        video.cloudinary_public_id || null,
        video.optimized_video_url || null,
        null,
        video.video_url
      )
    : { url: '', type: 'supabase' as const };
  
  const posterSrc = video 
    ? getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url)
    : '';

  const logEvent = useCallback((event: string, detail?: string) => {
    const elapsed = loadStartRef.current ? Math.round(performance.now() - loadStartRef.current) : 0;
    
    if (isDebugMode()) {
      console.log(`[SinglePlayer] ${event}${detail ? `: ${detail}` : ''} (+${elapsed}ms)`);
    }
    
    setDebugEvents(prev => [...prev.slice(-14), { time: elapsed, event, detail }]);
  }, []);

  // Sync with global mute state
  useEffect(() => {
    const listener = (muted: boolean) => {
      setIsMuted(muted);
      if (videoRef.current) {
        videoRef.current.muted = muted;
      }
    };
    muteListeners.add(listener);
    return () => { muteListeners.delete(listener); };
  }, []);

  // Main playback effect - only load when not scrolling and have a video
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video || isScrolling) {
      // If scrolling, pause and clear
      if (videoEl) {
        videoEl.pause();
      }
      return;
    }

    // Reset state for new video
    loadStartRef.current = performance.now();
    retryCountRef.current = 0;
    setPlaybackFailed(false);
    setIsPlaying(false);
    setTimeToMetadata(null);
    setTimeToPlaying(null);
    setHeadCheckStatus(null);
    setDebugEvents([]);
    
    logEvent('load_start', `video=${video.id}`);
    
    // Set source and load
    videoEl.src = videoSrc;
    videoEl.load();
    
    // HEAD check for debug
    if (isDebugMode()) {
      checkVideoUrlStatus(videoSrc).then(result => {
        setHeadCheckStatus(result.status || (result.accessible ? 200 : 0));
        logEvent('head_check', `status=${result.status || 'opaque'}`);
      });
    }

    let stallTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasPlayed = false;

    const clearStallTimeout = () => {
      if (stallTimeout) {
        clearTimeout(stallTimeout);
        stallTimeout = null;
      }
    };

    const handleLoadStart = () => logEvent('loadstart');
    
    const handleLoadedMetadata = () => {
      const elapsed = Math.round(performance.now() - loadStartRef.current);
      setTimeToMetadata(elapsed);
      logEvent('loadedmetadata', `duration=${videoEl.duration?.toFixed(1)}s`);
    };

    const handleCanPlay = () => {
      clearStallTimeout();
      logEvent('canplay', `readyState=${videoEl.readyState}`);
      
      if (!hasPlayed) {
        videoEl.play().catch(err => {
          logEvent('play_rejected', err.name);
        });
      }
    };

    const handlePlaying = () => {
      hasPlayed = true;
      setIsPlaying(true);
      clearStallTimeout();
      
      const elapsed = Math.round(performance.now() - loadStartRef.current);
      setTimeToPlaying(elapsed);
      logEvent('playing', `TTFF=${elapsed}ms`);
      
      onPlaybackStarted();
    };

    const handleWaiting = () => {
      logEvent('waiting');
      if (!hasPlayed && !stallTimeout) {
        stallTimeout = setTimeout(() => {
          logEvent('stall_timeout', '5000ms');
          handleStall();
        }, 5000);
      }
    };

    const handleStalled = () => {
      logEvent('stalled');
    };

    const handleError = () => {
      const error = videoEl.error;
      const msg = error ? `code=${error.code}` : 'unknown';
      logEvent('error', msg);
      
      retryCountRef.current++;
      if (retryCountRef.current >= 3) {
        setPlaybackFailed(true);
      } else {
        // Retry with same source
        videoEl.load();
        videoEl.play().catch(() => {});
      }
    };

    const handleStall = () => {
      retryCountRef.current++;
      if (retryCountRef.current >= 3) {
        setPlaybackFailed(true);
      } else {
        logEvent('retry', `attempt=${retryCountRef.current}`);
        videoEl.load();
        videoEl.play().catch(() => {});
      }
    };

    videoEl.addEventListener('loadstart', handleLoadStart);
    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoEl.addEventListener('canplay', handleCanPlay);
    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('stalled', handleStalled);
    videoEl.addEventListener('error', handleError);

    // Initial timeout - 8s for first load
    stallTimeout = setTimeout(() => {
      if (!hasPlayed && videoEl.readyState < 3) {
        logEvent('initial_timeout', `readyState=${videoEl.readyState}`);
        handleStall();
      }
    }, 8000);

    return () => {
      clearStallTimeout();
      videoEl.removeEventListener('loadstart', handleLoadStart);
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoEl.removeEventListener('canplay', handleCanPlay);
      videoEl.removeEventListener('playing', handlePlaying);
      videoEl.removeEventListener('waiting', handleWaiting);
      videoEl.removeEventListener('stalled', handleStalled);
      videoEl.removeEventListener('error', handleError);
      
      // Clear source on cleanup
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    };
  }, [video?.id, videoSrc, isScrolling, logEvent, onPlaybackStarted]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  const handleRetry = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video) return;
    
    retryCountRef.current = 0;
    setPlaybackFailed(false);
    loadStartRef.current = performance.now();
    logEvent('manual_retry');
    
    videoEl.src = videoSrc;
    videoEl.load();
    videoEl.play().catch(() => {});
  }, [video, videoSrc, logEvent]);

  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  // Debug metrics
  const debugMetrics: DebugMetrics = {
    activeIndex,
    videoId: video?.id || '',
    sourceUrl: videoSrc,
    sourceType,
    headCheckStatus,
    timeToMetadata,
    timeToPlaying,
    abortedPrefetches,
    retries: retryCountRef.current,
    readyState: videoRef.current?.readyState || 0,
    networkState: videoRef.current?.networkState || 0,
    events: debugEvents,
    isScrolling,
  };

  if (!video) return null;

  return (
    <>
      {/* Poster background - always visible until video plays */}
      <img 
        src={posterSrc} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover md:object-contain pointer-events-none z-10"
        style={{ paddingBottom: navOffset }}
      />

      {/* Video element - THE ONLY ONE */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover md:object-contain z-20 transition-opacity duration-200 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingBottom: navOffset }}
        poster={posterSrc}
        loop
        playsInline
        muted={isMuted}
        preload="auto"
        onClick={toggleMute}
      />

      {/* Loading indicator - only show if not playing and not failed */}
      {!isPlaying && !playbackFailed && !isScrolling && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Playback failed - retry UI */}
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div className="bg-black/50 rounded-full p-4 animate-scale-in">
            {isMuted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Debug overlay */}
      {isDebugMode() && <DebugOverlay metrics={debugMetrics} />}
    </>
  );
});

SinglePlayer.displayName = 'SinglePlayer';
