import { useRef, useCallback } from "react";
import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

/**
 * Dead-simple HLS player hook.
 * 
 * Rules:
 * 1. Only ONE video should have a source attached at a time
 * 2. attachSource destroys any previous HLS instance first
 * 3. detachSource fully releases the video element
 * 4. No caching, no dedup — always fresh
 */

interface UseHlsPlayerOptions {
  cloudflareVideoId: string | null | undefined;
  fallbackUrl: string;
}

export function useHlsPlayer({ cloudflareVideoId, fallbackUrl }: UseHlsPlayerOptions) {
  const hlsRef = useRef<Hls | null>(null);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const attachSource = useCallback((videoEl: HTMLVideoElement) => {
    // Always start clean
    destroyHls();

    if (!cloudflareVideoId) {
      videoEl.src = fallbackUrl;
      return;
    }

    const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);

    if (supportsHlsNatively()) {
      // Safari/iOS — native HLS
      videoEl.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 4,
        maxMaxBufferLength: 15,
        maxBufferSize: 20 * 1000 * 1000,
        startLevel: 0,
        capLevelToPlayerSize: true,
        lowLatencyMode: false,
        backBufferLength: 3,
        enableWorker: true,
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.warn('[HLS] Fatal error:', data.type, data.details);
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          // Let the component handle it via the video element's error event
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

  const detachSource = useCallback((videoEl: HTMLVideoElement) => {
    destroyHls();
    try {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load(); // Abort any pending loads
    } catch {
      // best-effort
    }
  }, [destroyHls]);

  return { attachSource, detachSource };
}

// ===== PREFETCH (network cache warming only — no HLS instances) =====

const prefetchedManifests = new Set<string>();

/**
 * Warm the browser's network cache by fetching the HLS manifest.
 * Uses low priority so it doesn't compete with active playback.
 * Does NOT create any HLS instance or MediaSource.
 */
export function prefetchHlsManifest(cloudflareVideoId: string | null | undefined): void {
  if (!cloudflareVideoId) return;
  if (prefetchedManifests.has(cloudflareVideoId)) return;
  prefetchedManifests.add(cloudflareVideoId);

  const url = getCloudflareStreamUrl(cloudflareVideoId);
  fetch(url, { priority: 'low' as any, mode: 'cors' })
    .then(res => {
      if (!res.ok) return;
      return res.text();
    })
    .then(manifest => {
      if (!manifest) return;
      // Find first variant playlist and prefetch it
      const lines = manifest.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const variantUrl = trimmed.startsWith('http')
            ? trimmed
            : new URL(trimmed, url).href;
          fetch(variantUrl, { priority: 'low' as any, mode: 'cors' }).catch(() => {});
          break;
        }
      }
    })
    .catch(() => {});
}

export function resetPrefetchCache(): void {
  prefetchedManifests.clear();
}
