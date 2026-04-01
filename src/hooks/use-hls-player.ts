import { useRef, useCallback } from "react";
import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

/**
 * HLS player hook with readiness signaling.
 * 
 * Key design:
 * - `activate()` does full teardown → gap → attach → wait for ready → play()
 * - `deactivate()` does full hard teardown
 * - Only ONE video should be activated at a time
 * - Stuck detection auto-recovers if video doesn't play within timeout
 */

const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : ''
);
// Gap between teardown and re-attach to let mobile media pipeline release
const TEARDOWN_GAP_MS = IS_MOBILE ? 100 : 0;
// If video hasn't reached 'playing' state within this time, force retry
const STUCK_TIMEOUT_MS = 4000;

const log = (tag: string, videoId: string, extra: Record<string, unknown> = {}) => {
  console.log(`[HLS:${tag}]`, videoId.slice(0, 8), {
    ...extra,
    t: Date.now() % 100000,
  });
};

interface UseHlsPlayerOptions {
  cloudflareVideoId: string | null | undefined;
  fallbackUrl: string;
}

export function useHlsPlayer({ cloudflareVideoId, fallbackUrl }: UseHlsPlayerOptions) {
  const hlsRef = useRef<Hls | null>(null);
  const activeRunRef = useRef(0);

  const hardReset = useCallback((videoEl: HTMLVideoElement) => {
    // Destroy any hls.js instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    try {
      videoEl.pause();
      videoEl.srcObject = null;
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch {
      // best-effort
    }
  }, []);

  /**
   * Activate: teardown → gap → attach → wait for readiness → play().
   * Returns a cleanup function.
   * All async operations are gated on `run` to prevent stale execution.
   */
  const activate = useCallback((
    videoEl: HTMLVideoElement,
    callbacks: {
      onPlaying: () => void;
      onFailed: () => void;
    }
  ) => {
    const run = ++activeRunRef.current;
    const stale = () => run !== activeRunRef.current;
    const vid = cloudflareVideoId || 'fallback';
    let stuckTimer: ReturnType<typeof setTimeout> | null = null;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    log('activate:start', vid, { readyState: videoEl.readyState, networkState: videoEl.networkState });

    // Step 1: Hard reset any previous state
    hardReset(videoEl);

    const doAttach = () => {
      if (stale()) return;
      log('attach:start', vid);

      // Clear any previous stuck timer
      if (stuckTimer) clearTimeout(stuckTimer);

      const onPlayingFired = () => {
        if (stale()) return;
        if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
        log('playing', vid, { readyState: videoEl.readyState, currentTime: videoEl.currentTime });
        callbacks.onPlaying();
      };

      const attemptPlay = async () => {
        if (stale()) return;
        log('play:call', vid, { readyState: videoEl.readyState, paused: videoEl.paused });
        try {
          videoEl.currentTime = 0;
          await videoEl.play();
          log('play:resolved', vid);
        } catch (err: any) {
          if (stale()) return;
          if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
            log('play:benign-reject', vid, { name: err.name });
            return;
          }
          log('play:rejected', vid, { name: err.name, message: err.message });
          handleStuck('play-rejected');
        }
      };

      const handleStuck = (reason: string) => {
        if (stale()) return;
        // If already playing, ignore
        if (!videoEl.paused && videoEl.currentTime > 0) return;
        
        retryCount++;
        log('stuck', vid, { reason, retryCount, readyState: videoEl.readyState, networkState: videoEl.networkState });
        
        if (retryCount <= MAX_RETRIES) {
          // Full teardown and re-attach
          cleanup();
          hardReset(videoEl);
          gapTimer = setTimeout(() => {
            if (stale()) return;
            doAttach();
          }, TEARDOWN_GAP_MS + 200); // Slightly longer gap for retries
        } else {
          log('failed', vid);
          callbacks.onFailed();
        }
      };

      // Set stuck timeout BEFORE any async work
      stuckTimer = setTimeout(() => {
        if (stale()) return;
        handleStuck('timeout');
      }, STUCK_TIMEOUT_MS);

      // Listen for playing event
      videoEl.addEventListener('playing', onPlayingFired, { once: true });

      // Track cleanup for this specific attachment
      const cleanupListeners = () => {
        videoEl.removeEventListener('playing', onPlayingFired);
      };

      if (!cloudflareVideoId) {
        // Fallback: simple src
        videoEl.src = fallbackUrl;
        videoEl.addEventListener('canplay', () => attemptPlay(), { once: true });
        log('attach:fallback', vid);
      } else if (supportsHlsNatively()) {
        // Safari/iOS: native HLS
        const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);
        
        const onCanPlay = () => {
          if (stale()) return;
          log('canplay:native', vid, { readyState: videoEl.readyState });
          attemptPlay();
        };
        const onError = () => {
          if (stale()) return;
          log('error:native', vid, { error: videoEl.error?.code });
          handleStuck('native-error');
        };

        videoEl.addEventListener('canplay', onCanPlay, { once: true });
        videoEl.addEventListener('loadeddata', onCanPlay, { once: true });
        videoEl.addEventListener('error', onError, { once: true });

        videoEl.src = hlsUrl;
        log('attach:native-hls', vid);

        // Extend cleanup
        const origCleanup = cleanupListeners;
        Object.assign(cleanupListeners, () => {
          origCleanup();
          videoEl.removeEventListener('canplay', onCanPlay);
          videoEl.removeEventListener('loadeddata', onCanPlay);
          videoEl.removeEventListener('error', onError);
        });
      } else if (Hls.isSupported()) {
        // Chrome/Firefox: hls.js
        const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);
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
        hlsRef.current = hls;

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          log('MEDIA_ATTACHED', vid);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (stale()) return;
          log('MANIFEST_PARSED', vid, { readyState: videoEl.readyState });
          // HLS is truly ready — safe to play
          attemptPlay();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (stale()) return;
          if (!data.fatal) return;
          log('hls:fatal', vid, { type: data.type, details: data.details });
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            handleStuck('hls-fatal');
          }
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(videoEl);
        log('attach:hls.js', vid);
      } else {
        videoEl.src = fallbackUrl;
        videoEl.addEventListener('canplay', () => attemptPlay(), { once: true });
      }

      // Store cleanup for this attachment cycle
      attachCleanup = () => {
        cleanupListeners();
      };
    };

    let attachCleanup: (() => void) | null = null;

    const cleanup = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      attachCleanup?.();
      attachCleanup = null;
    };

    // Step 2: Wait for gap, then attach
    if (TEARDOWN_GAP_MS > 0) {
      gapTimer = setTimeout(() => {
        if (stale()) return;
        log('gap:done', vid);
        doAttach();
      }, TEARDOWN_GAP_MS);
    } else {
      doAttach();
    }

    // Return master cleanup
    return () => {
      activeRunRef.current++;
      if (gapTimer) clearTimeout(gapTimer);
      cleanup();
      hardReset(videoEl);
      log('deactivate', vid);
    };
  }, [cloudflareVideoId, fallbackUrl, hardReset]);

  const deactivate = useCallback((videoEl: HTMLVideoElement) => {
    activeRunRef.current++;
    hardReset(videoEl);
  }, [hardReset]);

  return { activate, deactivate };
}

// ===== PREFETCH (network cache warming only — no HLS instances) =====

const prefetchedManifests = new Set<string>();

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