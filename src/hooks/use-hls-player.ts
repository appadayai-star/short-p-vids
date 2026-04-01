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

  // Destroy any existing HLS instance
  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  /**
   * Attach HLS source to a video element.
   * Always destroys previous instance first — no dedup cache.
   * This prevents stale/poisoned HLS instances from blocking playback.
   */
  const attachSource = useCallback((videoEl: HTMLVideoElement) => {
    destroyHls();

    if (!cloudflareVideoId) {
      videoEl.src = fallbackUrl;
      return;
    }

    const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);

    if (supportsHlsNatively()) {
      videoEl.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 4,
        maxMaxBufferLength: 20,
        maxBufferSize: 30 * 1000 * 1000,
        startLevel: 0,
        capLevelToPlayerSize: true,
        testBandwidth: true,
        lowLatencyMode: false,
        backBufferLength: 5,
        enableWorker: true,
        abrEwmaDefaultEstimate: 1_000_000,
        startFragPrefetch: true,
      });

      // Handle HLS.js fatal errors to prevent poisoned MediaSource
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.warn('[HLS] Fatal error:', data.type, data.details);
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          // Destroy and dispatch error so component retry logic kicks in
          hls.destroy();
          hlsRef.current = null;
          videoEl.dispatchEvent(new Event('error'));
        }
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);
      hlsRef.current = hls;
    } else {
      videoEl.src = fallbackUrl;
    }
  }, [cloudflareVideoId, fallbackUrl, destroyHls]);

  /**
   * Hard-reset a video element: destroy HLS, remove src, abort loads.
   * This fully releases the MediaSource so other elements can use it.
   */
  const detachSource = useCallback((videoEl: HTMLVideoElement) => {
    destroyHls();
    try {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch {
      // best-effort
    }
  }, [destroyHls]);


  // Cleanup on unmount or when cloudflareVideoId changes
  useEffect(() => {
    return () => {
      destroyHls();
    };
  }, [destroyHls]);

  return { attachSource, detachSource, destroyHls };
}

// ===== PREFETCH SYSTEM =====
// Track what we've already prefetched to avoid duplicate fetches
const prefetchedManifests = new Set<string>();
const prefetchedSegments = new Set<string>();

/**
 * Deep prefetch: manifest → variant playlist → first segment.
 * This ensures the browser cache is warm so HLS.js can start instantly.
 * Uses low priority to not compete with active playback.
 */
export function prefetchHlsManifest(cloudflareVideoId: string | null | undefined): void {
  if (!cloudflareVideoId) return;
  if (prefetchedManifests.has(cloudflareVideoId)) return;
  prefetchedManifests.add(cloudflareVideoId);

  try {
    const url = getCloudflareStreamUrl(cloudflareVideoId);
    
    fetch(url, { priority: 'low' as any, mode: 'cors' })
      .then(res => {
        if (!res.ok) return;
        return res.text();
      })
      .then(manifest => {
        if (!manifest) return;
        // Parse master playlist to find variant playlists
        const lines = manifest.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            // First non-comment line = variant playlist (or segment for simple playlists)
            const variantUrl = trimmed.startsWith('http')
              ? trimmed
              : new URL(trimmed, url).href;
            
            if (prefetchedSegments.has(variantUrl)) break;
            prefetchedSegments.add(variantUrl);
            
            // Fetch the variant playlist, then warm its first segment
            fetch(variantUrl, { priority: 'low' as any, mode: 'cors' })
              .then(res => res.ok ? res.text() : null)
              .then(variantManifest => {
                if (!variantManifest) return;
                // Find first .ts segment in variant playlist
                const segLines = variantManifest.split('\n');
                for (const segLine of segLines) {
                  const seg = segLine.trim();
                  if (seg && !seg.startsWith('#') && (seg.endsWith('.ts') || seg.includes('.ts?') || seg.includes('seg-'))) {
                    const segUrl = seg.startsWith('http')
                      ? seg
                      : new URL(seg, variantUrl).href;
                    if (!prefetchedSegments.has(segUrl)) {
                      prefetchedSegments.add(segUrl);
                      fetch(segUrl, { priority: 'low' as any, mode: 'cors' }).catch(() => {});
                    }
                    break;
                  }
                }
              })
              .catch(() => {});
            break; // Only warm the first (lowest quality) variant
          }
        }
      })
      .catch(() => {});
  } catch {
    // Ignore
  }
}

/**
 * Eagerly prefetch a video — higher priority than prefetchHlsManifest.
 * Used for the FIRST video in feed (must be instant) and the immediate next video.
 */
export function eagerPrefetchVideo(cloudflareVideoId: string | null | undefined): void {
  if (!cloudflareVideoId) return;
  // Skip dedup for eager — we want to ensure it's cached even if low-priority fetch happened
  const url = getCloudflareStreamUrl(cloudflareVideoId);
  prefetchedManifests.add(cloudflareVideoId);

  fetch(url, { mode: 'cors' }) // default priority (high)
    .then(res => {
      if (!res.ok) return;
      return res.text();
    })
    .then(manifest => {
      if (!manifest) return;
      const lines = manifest.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const variantUrl = trimmed.startsWith('http')
            ? trimmed
            : new URL(trimmed, url).href;

          fetch(variantUrl, { mode: 'cors' })
            .then(res => res.ok ? res.text() : null)
            .then(variantManifest => {
              if (!variantManifest) return;
              const segLines = variantManifest.split('\n');
              for (const segLine of segLines) {
                const seg = segLine.trim();
                if (seg && !seg.startsWith('#') && (seg.endsWith('.ts') || seg.includes('.ts?') || seg.includes('seg-'))) {
                  const segUrl = seg.startsWith('http')
                    ? seg
                    : new URL(seg, variantUrl).href;
                  fetch(segUrl, { mode: 'cors' }).catch(() => {});
                  break;
                }
              }
            })
            .catch(() => {});
          break;
        }
      }
    })
    .catch(() => {});
}

/**
 * Reset prefetch tracking (e.g., when navigating to a new feed)
 */
export function resetPrefetchCache(): void {
  prefetchedManifests.clear();
  prefetchedSegments.clear();
}
