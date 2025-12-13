import { memo, useRef, useEffect, useState, useCallback } from "react";
import { RefreshCw, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";
import { DebugOverlay, DebugEvent, DebugMetrics, VideoErrorInfo } from "./DebugOverlay";

// Global mute state
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

type FailureReason = 'none' | 'url_404' | 'url_403' | 'url_error' | 'autoplay_blocked' | 'canplay_timeout' | 'decode_error' | 'network_error' | 'unknown';

// Preflight HEAD check - DEBUG ONLY, never blocks playback
async function preflightCheck(url: string, timeoutMs = 6000): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { 
      method: 'HEAD', 
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timeoutId);
    return { ok: response.ok, status: response.status, error: null };
  } catch (err) {
    clearTimeout(timeoutId);
    // Try no-cors as fallback (can't read status but can detect network errors)
    try {
      await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(2000) });
      return { ok: true, status: null, error: null }; // Opaque response = likely OK
    } catch (e2) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: null, error: errorMsg };
    }
  }
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
  const preflightAbortRef = useRef<AbortController | null>(null);
  
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [srcAssigned, setSrcAssigned] = useState(false);
  
  // Debug state
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [preflightStatus, setPreflightStatus] = useState<'pending' | 'ok' | 'failed'>('pending');
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightHttpStatus, setPreflightHttpStatus] = useState<number | null>(null);
  const [timeToMetadata, setTimeToMetadata] = useState<number | null>(null);
  const [timeToPlaying, setTimeToPlaying] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<VideoErrorInfo | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<FailureReason>('none');

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
    
    setDebugEvents(prev => [...prev.slice(-19), { time: elapsed, event, detail }]);
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

  // Main playback effect - assign src IMMEDIATELY, preflight is parallel debug-only
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !video) {
      setSrcAssigned(false);
      return;
    }

    // Cancel any pending preflight
    if (preflightAbortRef.current) {
      preflightAbortRef.current.abort();
    }
    preflightAbortRef.current = new AbortController();
    const abortSignal = preflightAbortRef.current.signal;

    // Reset state for new video
    loadStartRef.current = performance.now();
    retryCountRef.current = 0;
    setPlaybackFailed(false);
    setIsPlaying(false);
    setSrcAssigned(false);
    setTimeToMetadata(null);
    setTimeToPlaying(null);
    setPreflightStatus('pending');
    setPreflightError(null);
    setPreflightHttpStatus(null);
    setVideoError(null);
    setPlayError(null);
    setFailureReason('none');
    setDebugEvents([]);
    
    logEvent('video_change', `id=${video.id}, scrolling=${isScrolling}`);
    
    // If scrolling, just show poster and wait
    if (isScrolling) {
      logEvent('scroll_pause', 'waiting for scroll to settle');
      videoEl.pause();
      videoEl.removeAttribute('src');
      return;
    }

    let stallTimeout: ReturnType<typeof setTimeout> | null = null;
    let metadataTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasPlayed = false;

    const clearTimeouts = () => {
      if (stallTimeout) { clearTimeout(stallTimeout); stallTimeout = null; }
      if (metadataTimeout) { clearTimeout(metadataTimeout); metadataTimeout = null; }
    };

    // Run preflight in PARALLEL for debug only - NEVER blocks playback
    if (isDebugMode()) {
      preflightCheck(videoSrc, 6000).then(preflight => {
        if (abortSignal.aborted) return;
        setPreflightHttpStatus(preflight.status);
        if (preflight.ok) {
          setPreflightStatus('ok');
          logEvent('preflight_ok', `status=${preflight.status || 'opaque'}`);
        } else {
          setPreflightStatus('failed');
          setPreflightError(preflight.error || `HTTP ${preflight.status}`);
          logEvent('preflight_failed', preflight.error || `status=${preflight.status}`);
        }
      });
    }

    // IMMEDIATELY assign src and start playback - no gating on preflight
    videoEl.muted = isMuted;
    videoEl.playsInline = true;
    videoEl.preload = 'auto';
    videoEl.src = videoSrc;
    setSrcAssigned(true);
    logEvent('src_assigned', videoSrc.substring(0, 80));
    
    // Call load() immediately
    videoEl.load();
    logEvent('load_called');

    const handleLoadStart = () => logEvent('loadstart');
    
    const handleLoadedMetadata = () => {
      if (metadataTimeout) { clearTimeout(metadataTimeout); metadataTimeout = null; }
      const elapsed = Math.round(performance.now() - loadStartRef.current);
      setTimeToMetadata(elapsed);
      logEvent('loadedmetadata', `duration=${videoEl.duration?.toFixed(1)}s, elapsed=${elapsed}ms`);
    };

    const handleCanPlay = () => {
      clearTimeouts();
      logEvent('canplay', `readyState=${videoEl.readyState}`);
      
      if (!hasPlayed) {
        videoEl.play()
          .then(() => {
            logEvent('play_promise_resolved');
          })
          .catch(err => {
            const errStr = `${err.name}: ${err.message}`;
            setPlayError(errStr);
            logEvent('play_rejected', errStr);
            
            // Only mark as failure if NOT an autoplay restriction
            if (err.name === 'NotAllowedError') {
              // Autoplay blocked - not fatal, user can tap to play
              setFailureReason('autoplay_blocked');
              logEvent('autoplay_blocked', 'user interaction required');
            } else if (err.name !== 'AbortError') {
              // AbortError is expected when src changes rapidly
              setFailureReason('unknown');
            }
          });
      }
    };

    const handlePlaying = () => {
      hasPlayed = true;
      setIsPlaying(true);
      clearTimeouts();
      setFailureReason('none');
      setPlayError(null);
      
      const elapsed = Math.round(performance.now() - loadStartRef.current);
      setTimeToPlaying(elapsed);
      logEvent('playing', `TTFF=${elapsed}ms`);
      
      onPlaybackStarted();
    };

    const handleWaiting = () => {
      logEvent('waiting', `readyState=${videoEl.readyState}`);
    };

    const handleStalled = () => {
      logEvent('stalled', `readyState=${videoEl.readyState}, networkState=${videoEl.networkState}`);
    };

    const handleError = () => {
      const error = videoEl.error;
      const errorInfo: VideoErrorInfo = {
        code: error?.code || null,
        message: error?.message || null,
        mediaError: error ? `MEDIA_ERR_${['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'][error.code] || 'UNKNOWN'}` : null,
      };
      setVideoError(errorInfo);
      
      logEvent('error', `code=${error?.code}, msg=${error?.message}, currentSrc=${videoEl.currentSrc}`);
      
      // Determine failure reason from error code
      if (error?.code === 2) {
        setFailureReason('network_error');
      } else if (error?.code === 3) {
        setFailureReason('decode_error');
      } else if (error?.code === 4) {
        setFailureReason('url_error');
      } else {
        setFailureReason('unknown');
      }
      
      retryCountRef.current++;
      if (retryCountRef.current >= 3) {
        setPlaybackFailed(true);
      } else {
        logEvent('retry', `attempt=${retryCountRef.current}`);
        videoEl.load();
        videoEl.play().catch(e => {
          if (e.name !== 'AbortError') {
            setPlayError(`${e.name}: ${e.message}`);
          }
        });
      }
    };

    const handleMetadataTimeout = () => {
      logEvent('metadata_timeout', `readyState=${videoEl.readyState}, networkState=${videoEl.networkState}`);
      if (videoEl.readyState < 1) {
        setFailureReason('canplay_timeout');
        retryCountRef.current++;
        if (retryCountRef.current >= 3) {
          setPlaybackFailed(true);
        } else {
          logEvent('retry_metadata', `attempt=${retryCountRef.current}`);
          videoEl.load();
          videoEl.play().catch(e => {
            if (e.name !== 'AbortError') {
              setPlayError(`${e.name}: ${e.message}`);
            }
          });
        }
      }
    };

    const handleCanplayTimeout = () => {
      logEvent('canplay_timeout', `readyState=${videoEl.readyState}, networkState=${videoEl.networkState}`);
      if (videoEl.readyState < 3 && !hasPlayed) {
        retryCountRef.current++;
        if (retryCountRef.current >= 3) {
          setPlaybackFailed(true);
        } else {
          logEvent('retry_canplay', `attempt=${retryCountRef.current}`);
          videoEl.load();
          videoEl.play().catch(e => {
            if (e.name !== 'AbortError') {
              setPlayError(`${e.name}: ${e.message}`);
            }
          });
        }
      }
    };

    // Add event listeners
    videoEl.addEventListener('loadstart', handleLoadStart);
    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoEl.addEventListener('canplay', handleCanPlay);
    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('stalled', handleStalled);
    videoEl.addEventListener('error', handleError);

    // Timeout for loadedmetadata (8s in prod, 5s in dev)
    const metadataTimeoutMs = isDebugMode() ? 5000 : 8000;
    metadataTimeout = setTimeout(handleMetadataTimeout, metadataTimeoutMs);

    // Timeout for canplay after metadata (additional 4s)
    stallTimeout = setTimeout(handleCanplayTimeout, metadataTimeoutMs + 4000);

    return () => {
      clearTimeouts();
      if (preflightAbortRef.current) {
        preflightAbortRef.current.abort();
      }
      videoEl.removeEventListener('loadstart', handleLoadStart);
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoEl.removeEventListener('canplay', handleCanPlay);
      videoEl.removeEventListener('playing', handlePlaying);
      videoEl.removeEventListener('waiting', handleWaiting);
      videoEl.removeEventListener('stalled', handleStalled);
      videoEl.removeEventListener('error', handleError);
      
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    };
  }, [video?.id, videoSrc, isScrolling, isMuted, logEvent, onPlaybackStarted]);

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
    setFailureReason('none');
    setVideoError(null);
    setPlayError(null);
    loadStartRef.current = performance.now();
    logEvent('manual_retry');
    
    // Re-trigger the effect by toggling a state
    setSrcAssigned(false);
    setTimeout(() => {
      videoEl.src = videoSrc;
      setSrcAssigned(true);
      videoEl.load();
      videoEl.play().catch(e => {
        setPlayError(`${e.name}: ${e.message}`);
      });
    }, 100);
  }, [video, videoSrc, logEvent]);

  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  // Debug metrics
  const debugMetrics: DebugMetrics = {
    activeIndex,
    videoId: video?.id || '',
    sourceUrl: videoSrc,
    sourceType,
    preflightStatus,
    preflightError,
    preflightHttpStatus,
    timeToMetadata,
    timeToPlaying,
    abortedPrefetches,
    retries: retryCountRef.current,
    readyState: videoRef.current?.readyState || 0,
    networkState: videoRef.current?.networkState || 0,
    currentSrc: videoRef.current?.currentSrc || '',
    events: debugEvents,
    isScrolling,
    srcAssigned,
    videoError,
    playError,
    failureReason,
  };

  if (!video) return null;

  return (
    <>
      {/* Poster background */}
      <img 
        src={posterSrc} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover md:object-contain pointer-events-none z-10"
        style={{ paddingBottom: navOffset }}
      />

      {/* Video element */}
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

      {/* Loading indicator */}
      {!isPlaying && !playbackFailed && !isScrolling && srcAssigned && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Playback failed - show detailed reason in debug mode */}
      {playbackFailed && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/30 pointer-events-none">
          <button 
            onClick={handleRetry}
            className="flex flex-col items-center gap-2 p-4 bg-black/60 rounded-xl backdrop-blur-sm pointer-events-auto"
          >
            <RefreshCw className="h-8 w-8 text-white" />
            <span className="text-white text-sm">Tap to retry</span>
            {isDebugMode() && (
              <span className="text-red-400 text-xs">{failureReason.replace(/_/g, ' ').toUpperCase()}</span>
            )}
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
