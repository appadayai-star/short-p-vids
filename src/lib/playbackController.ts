/**
 * Global Serialized Playback Controller v2
 * 
 * RULES:
 * - ONE HLS instance, ONE active video at any time
 * - All operations serialized via promise chain — no overlap possible
 * - Every await is bounded — chain NEVER deadlocks
 * - On timeout, we STILL attempt play() — never block playback
 * - finally{} ensures chain always proceeds even on errors
 */

import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);
const RELEASE_GAP_MS = IS_MOBILE ? 100 : 10;
const READY_TIMEOUT_MS = 1500; // Short — we'll try play() regardless

// ---- Singleton state ----
let hls: Hls | null = null;
let activeEl: HTMLVideoElement | null = null;
let token = 0;
let chain: Promise<void> = Promise.resolve();

const log = (tag: string, id: string, extra: Record<string, unknown> = {}) => {
  console.debug(`[PC:${tag}]`, id.slice(0, 8), { ...extra, t: Date.now() % 100000 });
};

// ---- Internal helpers ----

function hardRelease(el: HTMLVideoElement) {
  try { el.pause(); } catch { /* */ }
  try { el.srcObject = null; el.removeAttribute("src"); el.load(); } catch { /* */ }
}

function destroyHls() {
  if (hls) { try { hls.destroy(); } catch { /* */ } hls = null; }
}

function teardown(id: string) {
  log("teardown", id);
  destroyHls();
  if (activeEl) { hardRelease(activeEl); activeEl = null; }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Race a promise against a timeout. Resolves to 'timeout' if it expires, otherwise the promise result. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), ms)),
  ]);
}

// ---- Public API ----

export interface ActivateCallbacks {
  onPlaying: () => void;
  onFailed: () => void;
}

export function activate(
  el: HTMLVideoElement,
  cloudflareVideoId: string | null | undefined,
  fallbackUrl: string,
  callbacks: ActivateCallbacks
): () => void {
  const myToken = ++token;
  const id = cloudflareVideoId || "fallback";
  let cancelled = false;
  const stale = () => myToken !== token || cancelled;

  log("activate:queue", id);

  chain = chain.then(async () => {
    if (stale()) return;

    // 1. Teardown previous
    teardown(id);

    // 2. Release gap
    await delay(RELEASE_GAP_MS);
    if (stale()) return;

    // 3. Attach source
    activeEl = el;
    el.playsInline = true;
    el.preload = "auto";
    log("attach:start", id);

    try {
      if (!cloudflareVideoId) {
        // Direct src fallback
        el.src = fallbackUrl;
        log("attach:fallback", id);
      } else if (supportsHlsNatively()) {
        // Safari/iOS native HLS
        el.src = getCloudflareStreamUrl(cloudflareVideoId);
        log("attach:native", id);
      } else if (Hls.isSupported()) {
        // hls.js for Chrome/Firefox
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

        // Wait for MEDIA_ATTACHED — bounded
        const attachResult = await withTimeout(
          new Promise<'attached'>(res => hlsInstance.once(Hls.Events.MEDIA_ATTACHED, () => res('attached'))),
          1000
        );
        log("media-attached", id, { result: attachResult });
        if (stale()) return;

        hlsInstance.loadSource(hlsUrl);
        log("attach:hls.js", id);

        // Wait for MANIFEST_PARSED — bounded
        const manifestResult = await withTimeout(
          new Promise<'parsed'>(res => hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => res('parsed'))),
          READY_TIMEOUT_MS
        );
        log("manifest", id, { result: manifestResult });
      } else {
        el.src = fallbackUrl;
        log("attach:fallback-nosupport", id);
      }
    } catch (err: any) {
      log("attach:error", id, { error: err.message });
      // Don't return — still try to play
    }

    if (stale()) return;

    // 4. Wait briefly for readiness (but DON'T block on it)
    if (el.readyState < 2) {
      const readyResult = await withTimeout(
        new Promise<'ready'>(res => {
          const cb = () => { el.removeEventListener('canplay', cb); el.removeEventListener('loadeddata', cb); res('ready'); };
          el.addEventListener('canplay', cb, { once: true });
          el.addEventListener('loadeddata', cb, { once: true });
        }),
        READY_TIMEOUT_MS
      );
      log("readiness", id, { result: readyResult, readyState: el.readyState });
    }

    if (stale()) return;

    // 5. ALWAYS attempt play
    log("play:call", id, { readyState: el.readyState, networkState: el.networkState, paused: el.paused });
    try {
      el.currentTime = 0;
      await el.play();
      if (stale()) return;
      log("play:ok", id);
      callbacks.onPlaying();
    } catch (err: any) {
      if (stale()) return;
      if (err.name === "AbortError" || err.name === "NotAllowedError") {
        log("play:benign", id, { name: err.name });
        callbacks.onPlaying(); // autoplay policy — still counts
        return;
      }
      log("play:failed", id, { name: err.name, message: err.message });
      callbacks.onFailed();
    }
  }).catch((err) => {
    // CRITICAL: catch ensures chain NEVER stalls
    log("chain:error", id, { error: String(err) });
    if (!stale()) callbacks.onFailed();
  });

  return () => { cancelled = true; };
}

export function deactivateVideo(el: HTMLVideoElement) {
  const myToken = ++token;
  chain = chain.then(() => {
    if (myToken !== token) return;
    if (activeEl === el) { teardown("deactivate"); } else { hardRelease(el); }
  }).catch(() => {});
}

export function releaseAll() {
  token++;
  destroyHls();
  if (activeEl) { hardRelease(activeEl); activeEl = null; }
  chain = Promise.resolve();
}
