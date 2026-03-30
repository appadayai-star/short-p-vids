import { useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

/**
 * Manages HLS.js lifecycle for a video element.
 * On Safari/iOS (native HLS), sets src directly to .m3u8.
 * On Chrome/Firefox, uses hls.js for adaptive streaming.
 * 
 * Returns attach/detach functions instead of auto-managing,
 * so the caller controls when to connect/disconnect the source.
 */

interface UseHlsPlayerOptions {
  cloudflareVideoId: string | null | undefined;
  fallbackUrl: string; // original video_url for non-cloudflare videos
}

export function useHlsPlayer({ cloudflareVideoId, fallbackUrl }: UseHlsPlayerOptions) {
  const hlsRef = useRef<Hls | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const attachedIdRef = useRef<string | null>(null);

  // Destroy any existing HLS instance
  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    attachedIdRef.current = null;
  }, []);

  // Attach HLS source to a video element
  const attachSource = useCallback((videoEl: HTMLVideoElement) => {
    videoElRef.current = videoEl;

    // If no cloudflare ID, fall back to direct URL
    if (!cloudflareVideoId) {
      destroyHls();
      videoEl.src = fallbackUrl;
      return;
    }

    // Skip if already attached to same video
    if (attachedIdRef.current === cloudflareVideoId && hlsRef.current) {
      return;
    }

    destroyHls();
    attachedIdRef.current = cloudflareVideoId;

    const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);

    if (supportsHlsNatively()) {
      // Safari/iOS: native HLS
      videoEl.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 4,          // start with 4s buffer (faster startup)
        maxMaxBufferLength: 20,      // can grow to 20s
        maxBufferSize: 30 * 1000 * 1000,
        startLevel: 0,               // start at lowest quality for instant first frame
        capLevelToPlayerSize: true,
        testBandwidth: true,
        lowLatencyMode: false,
        backBufferLength: 5,
        enableWorker: true,
        abrEwmaDefaultEstimate: 1_000_000, // assume 1Mbps initially (conservative, fast start)
        startFragPrefetch: true,     // prefetch first segment immediately
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);
      hlsRef.current = hls;
    } else {
      // Fallback: direct MP4 (very rare)
      videoEl.src = fallbackUrl;
    }
  }, [cloudflareVideoId, fallbackUrl, destroyHls]);

  // Detach and free resources
  const detachSource = useCallback((videoEl: HTMLVideoElement) => {
    destroyHls();
    try {
      videoEl.removeAttribute('src');
      videoEl.load(); // abort any pending network requests
    } catch {
      // best-effort
    }
    videoElRef.current = null;
  }, [destroyHls]);

  // Cleanup on unmount or when cloudflareVideoId changes
  useEffect(() => {
    return () => {
      destroyHls();
    };
  }, [destroyHls]);

  return { attachSource, detachSource, destroyHls };
}

/**
 * Prefetch an HLS manifest to warm the CDN edge cache.
 * Does a lightweight fetch of just the manifest (tiny file).
 */
export function prefetchHlsManifest(cloudflareVideoId: string | null | undefined): void {
  if (!cloudflareVideoId) return;
  try {
    const url = getCloudflareStreamUrl(cloudflareVideoId);
    // Use low-priority fetch to not compete with active playback
    fetch(url, { 
      priority: 'low' as any,
      mode: 'cors',
    }).catch(() => {
      // Silently ignore - this is best-effort prefetch
    });
  } catch {
    // Ignore
  }
}
