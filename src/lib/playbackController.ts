/**
 * Global Playback Controller v6
 * 
 * Key change from v5: supports "play unmuted from the start" to avoid
 * iOS Safari killing playback when muted→unmuted is flipped post-play.
 * 
 * Flow: teardown → attach (with desired mute state) → poll ready →
 *       play(unmuted if user wants) → if blocked, retry muted → verify → report
 * 
 * The caller passes wantsMuted. The onPlaying callback receives the actual
 * mute state so the UI can reflect reality without any post-play mute toggling.
 */

import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(UA);
export const IS_IOS_WEB = /iPhone|iPad|iPod/i.test(UA) || 
  (typeof navigator !== "undefined" && /Macintosh/i.test(UA) && navigator.maxTouchPoints > 1);

const RELEASE_GAP_MS = IS_MOBILE ? 80 : 20;

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

/** Poll until readyState >= 2, stale, or timeout. */
function pollReady(el: HTMLVideoElement, ms: number, stale: () => boolean): Promise<boolean> {
  return new Promise(resolve => {
    if (stale()) { resolve(false); return; }
    if (el.readyState >= 2) { resolve(true); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (stale()) { clearInterval(interval); resolve(false); return; }
      if (el.readyState >= 2 || Date.now() - start > ms) {
        clearInterval(interval);
        resolve(el.readyState >= 2);
      }
    }, 50);
  });
}

/** Verify playback: currentTime must advance. */
function verifyPlayback(el: HTMLVideoElement, ms: number, stale: () => boolean): Promise<boolean> {
  return new Promise(resolve => {
    if (stale()) { resolve(false); return; }
    const start = Date.now();
    const initialCT = el.currentTime;
    const interval = setInterval(() => {
      if (stale()) { clearInterval(interval); resolve(false); return; }
      const elapsed = Date.now() - start;
      const playing = !el.paused && el.currentTime > initialCT + 0.01;
      if (playing || elapsed > ms) { clearInterval(interval); resolve(playing); }
    }, 60);
  });
}

/** Attach HLS source to video element. */
function attachSource(
  el: HTMLVideoElement,
  cloudflareVideoId: string | null | undefined,
  fallbackUrl: string,
  muted: boolean
): boolean {
  // Set the desired mute state FROM THE START — never force muted=true
  // so iOS doesn't treat a later unmute as a new autoplay attempt.
  el.muted = muted;
  el.defaultMuted = muted;
  el.playsInline = true;
  el.autoplay = true;
  el.preload = "auto";
  if (muted) {
    el.setAttribute("muted", "");
  } else {
    el.removeAttribute("muted");
  }
  el.setAttribute("playsinline", "");
  el.setAttribute("autoplay", "");

  if (!cloudflareVideoId) {
    el.src = fallbackUrl;
    log("attach:fallback", cloudflareVideoId || "none", { muted });
    return false;
  }
  
  if (supportsHlsNatively()) {
    el.src = getCloudflareStreamUrl(cloudflareVideoId);
    log("attach:native", cloudflareVideoId, { muted });
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
    log("attach:hls.js", cloudflareVideoId, { muted });
    return true;
  }
  
  el.src = fallbackUrl;
  log("attach:fallback2", cloudflareVideoId, { muted });
  return false;
}

/**
 * Play attempt. If unmuted play is blocked (NotAllowedError), automatically
 * falls back to muted play. Returns { success, actuallyMuted }.
 */
async function attemptPlay(
  el: HTMLVideoElement,
  id: string,
  attempt: number,
  wantsMuted: boolean,
  stale: () => boolean
): Promise<{ success: boolean; actuallyMuted: boolean }> {
  if (stale()) return { success: false, actuallyMuted: true };
  
  // Set desired mute state BEFORE play — this is the critical fix.
  el.muted = wantsMuted;
  log(`play:attempt${attempt}`, id, { readyState: el.readyState, muted: wantsMuted });
  
  try {
    await el.play();
  } catch (err: any) {
    if (stale()) return { success: false, actuallyMuted: true };
    
    // If unmuted play was blocked, try again muted
    if (!wantsMuted && err.name === 'NotAllowedError') {
      log("play:unmuted-blocked, retrying muted", id);
      el.muted = true;
      try {
        await el.play();
      } catch {
        if (stale()) return { success: false, actuallyMuted: true };
        return { success: false, actuallyMuted: true };
      }
      if (stale()) return { success: false, actuallyMuted: true };
      const verified = await verifyPlayback(el, 800, stale);
      return { success: verified, actuallyMuted: true };
    }
    
    log("play:error", id, { name: err.name, attempt });
    return { success: false, actuallyMuted: true };
  }
  
  if (stale()) return { success: false, actuallyMuted: true };
  const verified = await verifyPlayback(el, 800, stale);
  return { success: verified, actuallyMuted: wantsMuted };
}

// ---- Public API ----

export interface ActivateCallbacks {
  /** Called when playback is verified. actuallyMuted tells the component the real audio state. */
  onPlaying: (actuallyMuted: boolean) => void;
  onFailed: () => void;
}

/**
 * Activate a video for playback.
 * wantsMuted: the user's desired mute state. If false, will try unmuted first.
 * Returns cancel function.
 */
export function activate(
  el: HTMLVideoElement,
  cloudflareVideoId: string | null | undefined,
  fallbackUrl: string,
  wantsMuted: boolean,
  callbacks: ActivateCallbacks
): () => void {
  const myToken = ++token;
  const id = cloudflareVideoId || "fallback";
  let cancelled = false;
  const stale = () => myToken !== token || cancelled;

  log("activate:queued", id, { wantsMuted });

  chain = chain.then(async () => {
    if (stale()) { log("activate:stale", id); return; }
    
    // 1. Teardown previous
    teardown(id);
    await delay(RELEASE_GAP_MS);
    if (stale()) return;

    // 2. Attach with desired mute state
    activeEl = el;
    attachSource(el, cloudflareVideoId, fallbackUrl, wantsMuted);
    if (stale()) return;

    // 3. Wait for readiness
    const ready = await pollReady(el, 2000, stale);
    if (stale()) return;

    // 4. First play attempt with desired mute state
    let result = ready
      ? await attemptPlay(el, id, 1, wantsMuted, stale)
      : { success: false, actuallyMuted: true };

    // 5. If failed, one full retry (always muted for safety)
    if (!result.success && !stale()) {
      log("retry:full", id);
      destroyHls();
      hardRelease(el);
      await delay(200);
      if (stale()) return;
      
      attachSource(el, cloudflareVideoId, fallbackUrl, true); // retry always muted
      if (stale()) return;
      
      const retryReady = await pollReady(el, 2500, stale);
      if (stale()) return;
      
      result = retryReady
        ? await attemptPlay(el, id, 2, true, stale) // retry muted
        : { success: false, actuallyMuted: true };
    }

    if (stale()) return;

    // 6. Report result
    if (result.success) {
      log("success", id, { ct: el.currentTime, muted: result.actuallyMuted });
      if (!stale()) callbacks.onPlaying(result.actuallyMuted);
    } else {
      log("failed", id);
      if (!stale()) callbacks.onFailed();
    }
  }).catch((err) => {
    log("chain:error", id, { error: String(err) });
    if (!stale()) callbacks.onFailed();
  });

  return () => { cancelled = true; };
}

/** Deactivate a video element. */
export function deactivateVideo(el: HTMLVideoElement) {
  if (activeEl === el) {
    chain = chain.then(() => {
      if (activeEl === el) { teardown("deactivate"); }
    }).catch(() => {});
  } else {
    hardRelease(el);
  }
}

export function releaseAll() {
  token++;
  destroyHls();
  if (activeEl) { hardRelease(activeEl); activeEl = null; }
  chain = Promise.resolve();
}
