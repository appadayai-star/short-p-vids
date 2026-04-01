/**
 * Simplified Global Playback Controller v4
 * 
 * Design: boring, deterministic, reliable.
 * 
 * - ONE active video at a time
 * - Serialized chain: teardown → attach → poll ready → play (muted) → verify
 * - ONE retry on failure, then call onFailed
 * - Audio is NOT managed here — components handle mute/unmute after onPlaying
 * - No speculative behavior, no overlapping recovery paths
 */

import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(UA);
export const IS_IOS_WEB = /iPhone|iPad|iPod/i.test(UA) || 
  (typeof navigator !== "undefined" && /Macintosh/i.test(UA) && navigator.maxTouchPoints > 1);

const RELEASE_GAP_MS = IS_MOBILE ? 100 : 20;

// ---- Singleton state ----
let hls: Hls | null = null;
let activeEl: HTMLVideoElement | null = null;
let token = 0;
let chain: Promise<void> = Promise.resolve();

const log = (tag: string, id: string, extra: Record<string, unknown> = {}) => {
  console.log(`[PC:${tag}]`, id.slice(0, 8), { ...extra, t: Date.now() % 100000 });
};

// ---- Helpers ----

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
  if (activeEl) { 
    try { activeEl.muted = true; } catch { /* */ }
    hardRelease(activeEl); 
    activeEl = null; 
  }
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Poll until readyState >= 2 or timeout. Never rejects. */
function pollReady(el: HTMLVideoElement, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    if (el.readyState >= 2) { resolve(true); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (el.readyState >= 2 || Date.now() - start > ms) {
        clearInterval(interval);
        resolve(el.readyState >= 2);
      }
    }, 50);
  });
}

/** Verify playback: currentTime must advance from initial value */
function verifyPlayback(el: HTMLVideoElement, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now();
    const initialCT = el.currentTime;
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const playing = !el.paused && el.currentTime > initialCT + 0.01;
      if (playing || elapsed > ms) {
        clearInterval(interval);
        resolve(playing);
      }
    }, 60);
  });
}

/** Attach HLS source to video element. Returns true if HLS.js was used. */
function attachSource(
  el: HTMLVideoElement,
  cloudflareVideoId: string | null | undefined,
  fallbackUrl: string
): boolean {
  // Set autoplay-required attributes
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.autoplay = true;
  el.preload = "auto";
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.setAttribute("autoplay", "");

  if (!cloudflareVideoId) {
    el.src = fallbackUrl;
    log("attach:fallback", cloudflareVideoId || "none");
    return false;
  }
  
  if (supportsHlsNatively()) {
    el.src = getCloudflareStreamUrl(cloudflareVideoId);
    log("attach:native", cloudflareVideoId);
    return false;
  }
  
  if (Hls.isSupported()) {
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
    
    hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) log("hls:fatal", cloudflareVideoId, { type: data.type, details: data.details });
    });
    
    hlsInstance.attachMedia(el);
    hlsInstance.loadSource(getCloudflareStreamUrl(cloudflareVideoId));
    log("attach:hls.js", cloudflareVideoId);
    return true;
  }
  
  el.src = fallbackUrl;
  log("attach:fallback2", cloudflareVideoId);
  return false;
}

/** Single play attempt: play() → verify currentTime advances */
async function attemptPlay(el: HTMLVideoElement, id: string, attempt: number, stale: () => boolean): Promise<boolean> {
  if (stale()) return false;
  
  el.muted = true; // Always muted for autoplay compliance
  log(`play:attempt${attempt}`, id, { readyState: el.readyState, paused: el.paused, ct: el.currentTime });
  
  try {
    await el.play();
  } catch (err: any) {
    log("play:error", id, { name: err.name, attempt });
    return false;
  }
  
  if (stale()) return false;
  return verifyPlayback(el, 1000);
}

// ---- Public API ----

export interface ActivateCallbacks {
  onPlaying: () => void;
  onFailed: () => void;
}

/**
 * Activate a video for playback.
 * 
 * Flow:
 * 1. Teardown previous video (inside serialized chain)
 * 2. Attach source (muted)
 * 3. Poll for readiness
 * 4. Play attempt 1
 * 5. If failed: full teardown → re-attach → play attempt 2
 * 6. If still failed: call onFailed
 * 7. If success: call onPlaying (video stays muted — component handles audio)
 * 
 * Returns cancel function.
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
  const stale = () => myToken !== token || cancelled;

  log("activate:queued", id);

  chain = chain.then(async () => {
    if (stale()) { log("activate:stale", id); return; }
    
    // 1. Teardown previous
    teardown(id);
    await delay(RELEASE_GAP_MS);
    if (stale()) return;

    // 2. Attach
    activeEl = el;
    attachSource(el, cloudflareVideoId, fallbackUrl);
    if (stale()) return;

    // 3. Wait for readiness
    await pollReady(el, 2000);
    if (stale()) return;

    // 4. First play attempt
    let success = await attemptPlay(el, id, 1, stale);

    // 5. If failed, one full retry: teardown → re-attach → play
    if (!success && !stale()) {
      log("retry:full", id);
      destroyHls();
      hardRelease(el);
      await delay(200);
      if (stale()) return;
      
      attachSource(el, cloudflareVideoId, fallbackUrl);
      if (stale()) return;
      
      await pollReady(el, 2500);
      if (stale()) return;
      
      success = await attemptPlay(el, id, 2, stale);
    }

    if (stale()) return;

    // 6. Report result
    if (success) {
      log("success", id, { ct: el.currentTime });
      callbacks.onPlaying();
    } else {
      log("failed", id);
      callbacks.onFailed();
    }
  }).catch((err) => {
    log("chain:error", id, { error: String(err) });
    if (!stale()) callbacks.onFailed();
  });

  return () => { cancelled = true; };
}

export function deactivateVideo(el: HTMLVideoElement) {
  chain = chain.then(() => {
    if (activeEl === el) { teardown("deactivate"); } else { hardRelease(el); }
  }).catch(() => {});
}

export function releaseAll() {
  token++;
  destroyHls();
  if (activeEl) { hardRelease(activeEl); activeEl = null; }
  chain = Promise.resolve();
}
