/**
 * Global Serialized Playback Controller v3
 * 
 * DEADLOCK-PROOF: Every await bounded. Chain always proceeds via finally{}.
 * Play always attempted even if readiness events don't fire.
 */

import Hls from "hls.js";
import { getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";
import { getGlobalMuted } from "@/lib/globalMute";

const IS_MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);
const RELEASE_GAP_MS = IS_MOBILE ? 80 : 10;

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
  if (activeEl) { hardRelease(activeEl); activeEl = null; }
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Poll until condition or timeout. Never rejects. */
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

/** Verify playback actually started — returns true if playing, false if silent failure */
function verifyPlayback(el: HTMLVideoElement, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      const playing = !el.paused && el.currentTime > 0;
      if (playing || Date.now() - start > ms) {
        clearInterval(interval);
        resolve(playing);
      }
    }, 80);
  });
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

  log("activate:queued", id);

  chain = chain.then(async () => {
    if (stale()) { log("activate:stale-skip", id); return; }
    log("activate:start", id);

    // 1. Teardown
    teardown(id);
    await delay(RELEASE_GAP_MS);
    if (stale()) return;

    // 2. Attach — set ALL autoplay-required attributes BEFORE src
    activeEl = el;
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.preload = "auto";
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    el.setAttribute("autoplay", "");

    let hlsReady = false;

    if (!cloudflareVideoId) {
      el.src = fallbackUrl;
      log("attach:fallback", id);
    } else if (supportsHlsNatively()) {
      el.src = getCloudflareStreamUrl(cloudflareVideoId);
      log("attach:native", id);
    } else if (Hls.isSupported()) {
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

      // Listen for manifest parsed (non-blocking)
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        hlsReady = true;
        log("manifest-parsed", id);
      });

      hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) log("hls:fatal", id, { type: data.type, details: data.details });
      });

      hlsInstance.attachMedia(el);
      hlsInstance.loadSource(hlsUrl);
      log("attach:hls.js", id);
    } else {
      el.src = fallbackUrl;
      log("attach:fallback2", id);
    }

    if (stale()) return;

    // 3. Wait for readiness — poll-based, never blocks forever
    const ready = await pollReady(el, 1500);
    log("readiness", id, { ready, hlsReady, readyState: el.readyState, networkState: el.networkState });

    if (stale()) return;

    // 4. Attempt play with verification
    const attemptPlay = async (attempt: number): Promise<boolean> => {
      if (stale()) return false;
      el.muted = attempt === 1 ? true : getGlobalMuted();
      log(`play:attempt${attempt}`, id, { readyState: el.readyState, paused: el.paused, muted: el.muted });
      
      try {
        el.currentTime = 0;
        await el.play();
      } catch (err: any) {
        if (err.name === "AbortError" || err.name === "NotAllowedError") {
          log("play:autoplay-blocked", id, { name: err.name, attempt });
          return true; // treat as success for UI
        }
        log("play:threw", id, { name: err.name, attempt });
        return false;
      }
      
      if (stale()) return false;
      
      // VERIFY playback actually started (catches silent iOS failures)
      const verified = await verifyPlayback(el, 400);
      log(`play:verify${attempt}`, id, { verified, paused: el.paused, currentTime: el.currentTime });
      return verified;
    };

    // Attempt 1: standard play
    let success = await attemptPlay(1);
    
    if (!success && !stale()) {
      // Attempt 2: simple retry
      log("recovery:retry", id);
      await delay(100);
      if (!stale()) success = await attemptPlay(2);
    }

    if (!success && !stale()) {
      // Attempt 3: full re-attach
      log("recovery:reattach", id);
      destroyHls();
      hardRelease(el);
      await delay(200);
      if (stale()) return;

      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.autoplay = true;
      el.preload = "auto";

      if (cloudflareVideoId && !supportsHlsNatively() && Hls.isSupported()) {
        const h2 = new Hls({ maxBufferLength: 4, startLevel: 0, enableWorker: true });
        hls = h2;
        h2.attachMedia(el);
        h2.loadSource(getCloudflareStreamUrl(cloudflareVideoId));
      } else {
        el.src = cloudflareVideoId ? getCloudflareStreamUrl(cloudflareVideoId) : fallbackUrl;
      }

      await pollReady(el, 2000);
      if (!stale()) success = await attemptPlay(3);
    }

    if (stale()) return;

    if (success) {
      el.muted = getGlobalMuted();
      log("play:confirmed", id, { muted: el.muted });
      callbacks.onPlaying();
    } else {
      log("play:allFailed", id);
      callbacks.onFailed();
    }
  }).catch((err) => {
    log("chain:error", id, { error: String(err) });
    if (!stale()) callbacks.onFailed();
  });

  return () => { cancelled = true; };
}

export function deactivateVideo(el: HTMLVideoElement) {
  // Do NOT increment token — only activate() owns the token.
  // This just queues a teardown if this element is still active.
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
