import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Loader2, RefreshCw, Play, Volume2, VolumeX } from "lucide-react";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";

// Global mute state
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();
const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(fn => fn(muted));
};

interface Video {
  id: string;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  thumbnail_url: string | null;
}

interface SimplePlayerProps {
  video: Video | null;
  containerRect: DOMRect | null;
  hasEntered: boolean;
  onViewTracked: (videoId: string) => void;
}

export const SimplePlayer = memo(({ video, containerRect, hasEntered, onViewTracked }: SimplePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackedRef = useRef<Set<string>>(new Set());
  const currentIdRef = useRef<string | null>(null);
  
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "needsInteraction">("loading");
  const [muted, setMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);

  // Get video URL
  const videoSrc = video ? getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    null,
    video.video_url
  ) : "";
  
  const posterSrc = video ? getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url) : "";

  // Sync global mute
  useEffect(() => {
    const listener = (m: boolean) => {
      setMuted(m);
      if (videoRef.current) videoRef.current.muted = m;
    };
    muteListeners.add(listener);
    return () => { muteListeners.delete(listener); };
  }, []);

  // Handle video change
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    
    if (video.id !== currentIdRef.current) {
      currentIdRef.current = video.id;
      setStatus("loading");
      
      el.pause();
      el.src = videoSrc;
      el.load();
    }
  }, [video?.id, videoSrc]);

  // Play when ready and entered
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video || status !== "ready" || !hasEntered) {
      if (el) el.pause();
      return;
    }

    el.currentTime = 0;
    el.play()
      .then(() => {
        if (!trackedRef.current.has(video.id)) {
          trackedRef.current.add(video.id);
          onViewTracked(video.id);
        }
      })
      .catch(err => {
        if (err.name === "NotAllowedError") {
          setStatus("needsInteraction");
        }
      });
  }, [status, hasEntered, video, onViewTracked]);

  // Event handlers
  const handleCanPlay = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);

  const handleRetry = useCallback(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    setStatus("loading");
    el.src = videoSrc;
    el.load();
  }, [video, videoSrc]);

  const toggleMute = useCallback(() => {
    setGlobalMuted(!muted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [muted]);

  const handleTap = useCallback(() => {
    if (status === "needsInteraction") {
      videoRef.current?.play().then(() => setStatus("ready")).catch(() => {});
    } else {
      toggleMute();
    }
  }, [status, toggleMute]);

  // Handle scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = document.getElementById('video-feed-container');
    if (!container) return;
    
    const direction = e.deltaY > 0 ? 1 : -1;
    const currentIndex = Math.round(container.scrollTop / container.clientHeight);
    container.scrollTo({ top: (currentIndex + direction) * container.clientHeight, behavior: 'smooth' });
  }, []);

  if (!video) return null;

  const rect = containerRect || { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };

  return (
    <div 
      className="fixed z-10 pointer-events-none"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover md:object-contain bg-black pointer-events-auto"
        loop
        playsInline
        muted={muted}
        preload="auto"
        poster={posterSrc}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onClick={handleTap}
      />

      {/* Loading */}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-black/50 rounded-full p-3">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50 pointer-events-auto">
          <button onClick={handleRetry} className="flex flex-col items-center gap-2 bg-black/70 rounded-xl px-6 py-4">
            <RefreshCw className="h-10 w-10 text-white" />
            <span className="text-white text-sm">Tap to retry</span>
          </button>
        </div>
      )}

      {/* Tap to play */}
      {status === "needsInteraction" && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-auto">
          <button onClick={handleTap} className="flex flex-col items-center gap-2 bg-black/70 rounded-xl px-6 py-4">
            <Play className="h-10 w-10 text-white fill-white" />
            <span className="text-white text-sm">Tap to play</span>
          </button>
        </div>
      )}

      {/* Mute flash */}
      {showMuteIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="bg-black/50 rounded-full p-4">
            {muted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
          </div>
        </div>
      )}

      {/* Mute indicator */}
      <div className="absolute bottom-[180px] right-[76px] z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 pointer-events-none">
        {muted ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-white" />}
      </div>
    </div>
  );
});

SimplePlayer.displayName = 'SimplePlayer';
