/**
 * Global Serialized Playback Controller
 * 
 * ARCHITECTURE:
 * - ONE global HLS instance, ONE active video element at any time
 * - All activate/deactivate calls are serialized through a promise chain
 * - No overlapping teardown/attach operations — impossible by design
 * - Mobile gets a controlled gap between teardown and re-attach
 * 
 * LIFECYCLE:
 * 1. activate(el, src) queues: teardown previous → gap → attach new → wait ready → play
 * 2. deactivate() queues: teardown current
 * 3. Each step checks a monotonic token to abort if superseded
 */

import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);
const RELEASE_GAP_MS = IS_MOBILE ? 120 : 20;
const READY_TIMEOUT_MS = 5000;

// ---- Singleton state ----
let hls: Hls | null = null;
let activeEl: HTMLVideoElement | null = null;
let token = 0;
let chain: Promise<void> = Promise.resolve();

const log = (tag: string, id: string, extra: Record<string, unknown> = {}) => {
  console.log(`[PC:${tag}]`, id.slice(0, 8), { ...extra, t: Date.now() % 100000 });
};

// ---- Internal helpers ----

function hardRelease(el: HTMLVideoElement) {
  try {
    el.pause();
  } catch { /* best effort */ }
  try {
    el.srcObject = null;
    el.removeAttribute("src");
    el.load();
  } catch { /* best effort */ }
}

function destroyHls() {
  if (hls) {
    try { hls.destroy(); } catch { /* best effort */ }
    hls = null;
  }
}

function teardown(id: string) {
  log("teardown", id);
  destroyHls();
  if (activeEl) {
    hardRelease(activeEl);
    activeEl = null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Wait for a video element to reach a ready-to-play state.
 * Resolves when ready, rejects on timeout.
 */
function waitForReady(
  el: HTMLVideoElement,
  myToken: number,
  id: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("ready-timeout"));
    }, READY_TIMEOUT_MS);

    const onReady = () => {
      if (myToken !== token) { cleanup(); reject(new Error("stale")); return; }
      log("ready", id, { readyState: el.readyState });
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("media-error"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener("canplay", onReady);
      el.removeEventListener("loadeddata", onReady);
      el.removeEventListener("error", onError);
    };

    // Already ready?
    if (el.readyState >= 3) {
      cleanup();
      resolve();
      return;
    }

    el.addEventListener("canplay", onReady, { once: true });
    el.addEventListener("loadeddata", onReady, { once: true });
    el.addEventListener("error", onError, { once: true });
  });
}

function waitForHlsReady(
  hlsInstance: Hls,
  myToken: number,
  id: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("hls-ready-timeout"));
    }, READY_TIMEOUT_MS);

    hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
      clearTimeout(timer);
      if (myToken !== token) { reject(new Error("stale")); return; }
      log("manifest-parsed", id);
      resolve();
    });

    hlsInstance.once(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        clearTimeout(timer);
        reject(new Error(`hls-fatal:${data.details}`));
      }
    });
  });
}

// ---- Public API ----

export interface ActivateCallbacks {
  onPlaying: () => void;
  onFailed: () => void;
}

/**
 * Activate a video element with the given source.
 * Automatically serialized — safe to call rapidly.
 * Returns a cancel function.
 */
export function activate(
  el: HTMLVideoElement,
  cloudflareVideoId: string | null | undefined,
  fallbackUrl: string,
  callbacks: ActivateCallbacks
): () => void {
  const myToken = ++token;
  const id = cloudflareVideoId || "fallback";
  let cancelled = false;

  log("activate:queue", id);

  chain = chain.then(async () => {
    if (myToken !== token || cancelled) return;

    // Step 1: Teardown previous
    teardown(id);

    // Step 2: Release gap
    await wait(RELEASE_GAP_MS);
    if (myToken !== token || cancelled) return;

    // Step 3: Attach new source
    activeEl = el;
    el.muted = el.muted; // preserve current mute state
    el.playsInline = true;
    el.preload = "auto";

    log("attach", id);

    let retries = 0;
    const MAX_RETRIES = 1;

    const tryAttach = async (): Promise<boolean> => {
      if (myToken !== token || cancelled) return false;

      try {
        if (!cloudflareVideoId) {
          // Simple fallback: direct src
          el.src = fallbackUrl;
          await waitForReady(el, myToken, id);
        } else if (supportsHlsNatively()) {
          // Safari/iOS: native HLS
          const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);
          el.src = hlsUrl;
          log("attach:native", id);
          await waitForReady(el, myToken, id);
        } else if (Hls.isSupported()) {
          // Chrome/Firefox: hls.js
          const hlsUrl = getCloudflareStreamUrl(cloudflareVideoId);
          const hlsInstance = new Hls({
            maxBufferLength: 4,
            maxMaxBufferLength: 15,
            maxBufferSize: 20 * 1000 * 1000,
            startLevel: 0,
            capLevelToPlayerSize: true,
            lowLatencyMode: false,
            backBufferLength: 3,
            enableWorker: true,
          });
          hls = hlsInstance;

          hlsInstance.attachMedia(el);
          
          // Wait for MEDIA_ATTACHED before loading source
          await new Promise<void>((resolve) => {
            hlsInstance.once(Hls.Events.MEDIA_ATTACHED, () => {
              log("media-attached", id);
              resolve();
            });
          });

          if (myToken !== token || cancelled) return false;

          hlsInstance.loadSource(hlsUrl);
          log("attach:hls.js", id);

          await waitForHlsReady(hlsInstance, myToken, id);
        } else {
          // Final fallback
          el.src = fallbackUrl;
          await waitForReady(el, myToken, id);
        }

        return true;
      } catch (err: any) {
        if (err.message === "stale" || myToken !== token || cancelled) return false;
        log("attach:error", id, { error: err.message, retry: retries });
        return false;
      }
    };

    // Try attach (with one retry)
    let ready = await tryAttach();
    if (!ready && retries < MAX_RETRIES && myToken === token && !cancelled) {
      retries++;
      log("retry", id, { attempt: retries });
      // Full cleanup before retry
      destroyHls();
      hardRelease(el);
      await wait(RELEASE_GAP_MS * 2);
      if (myToken !== token || cancelled) return;
      activeEl = el;
      ready = await tryAttach();
    }

    if (!ready || myToken !== token || cancelled) {
      if (myToken === token && !cancelled) {
        log("failed", id);
        callbacks.onFailed();
      }
      return;
    }

    // Step 4: Play
    if (myToken !== token || cancelled) return;
    log("play:call", id, { readyState: el.readyState, paused: el.paused });

    try {
      el.currentTime = 0;
      await el.play();
      if (myToken !== token || cancelled) return;
      log("playing", id);
      callbacks.onPlaying();
    } catch (err: any) {
      if (myToken !== token || cancelled) return;
      if (err.name === "AbortError" || err.name === "NotAllowedError") {
        log("play:benign", id, { name: err.name });
        // Still consider it "playing" for UI purposes — autoplay blocked is normal
        callbacks.onPlaying();
        return;
      }
      log("play:failed", id, { name: err.name, message: err.message });
      callbacks.onFailed();
    }
  }).catch((err) => {
    log("chain:error", id, { error: String(err) });
  });

  // Return cancel function
  return () => {
    cancelled = true;
  };
}

/**
 * Deactivate a specific video element.
 * Serialized — won't interfere with pending activations.
 */
export function deactivateVideo(el: HTMLVideoElement) {
  const myToken = ++token;
  const id = "deactivate";

  chain = chain.then(() => {
    if (myToken !== token) return;
    if (activeEl === el) {
      teardown(id);
    } else {
      // Element isn't the active one — just hard-release it
      hardRelease(el);
    }
  }).catch(() => {});
}

/**
 * Immediately release all resources (e.g., on page navigation).
 */
export function releaseAll() {
  token++;
  destroyHls();
  if (activeEl) {
    hardRelease(activeEl);
    activeEl = null;
  }
  chain = Promise.resolve();
}
