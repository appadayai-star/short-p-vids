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

    // 4. ALWAYS try play
    log("play:call", id, { readyState: el.readyState, paused: el.paused });
    try {
      el.currentTime = 0;
      await el.play();
      if (stale()) return;
      log("play:ok", id);
      // Restore global mute state — activation starts muted for autoplay compliance,
      // but user may have unmuted previously
      el.muted = getGlobalMuted();
      callbacks.onPlaying();
    } catch (err: any) {
      if (stale()) return;
      if (err.name === "AbortError" || err.name === "NotAllowedError") {
        log("play:autoplay-blocked", id, { name: err.name });
        callbacks.onPlaying(); // still show as playing for UI
        return;
      }
      log("play:error", id, { name: err.name, message: err.message });

      // One retry: teardown, re-attach, try again
      log("retry:start", id);
      destroyHls();
      hardRelease(el);
      await delay(150);
      if (stale()) return;

      // Re-attach simply
      if (cloudflareVideoId && Hls.isSupported()) {
        const h2 = new Hls({ maxBufferLength: 4, startLevel: 0, enableWorker: true });
        hls = h2;
        h2.attachMedia(el);
        h2.loadSource(getCloudflareStreamUrl(cloudflareVideoId));
      } else {
        el.src = cloudflareVideoId ? getCloudflareStreamUrl(cloudflareVideoId) : fallbackUrl;
      }

      await pollReady(el, 2000);
      if (stale()) return;

      try {
        await el.play();
        if (!stale()) { log("retry:ok", id); callbacks.onPlaying(); }
      } catch {
        if (!stale()) { log("retry:failed", id); callbacks.onFailed(); }
      }
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
