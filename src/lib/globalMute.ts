// Global mute state — shared across all playback surfaces (feed, modal, embed)
// Videos start muted by default (browser autoplay policy).
// When a user unmutes, ALL videos across the app play with sound.

import { IS_IOS_WEB } from "@/lib/playbackController";

let globalMuted = true;
const listeners = new Set<(muted: boolean) => void>();

export const getGlobalMuted = () => globalMuted;

export const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  listeners.forEach(fn => fn(muted));
};

export const onMuteChange = (fn: (muted: boolean) => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

// iOS session-based sound: tracks whether user wants sound this session.
// On iOS, we always start muted but restore sound after verified playback
// if user has unmuted during this session.
let iosUserWantsSound = false;

export const getIosUserWantsSound = () => iosUserWantsSound;
export const setIosUserWantsSound = (wants: boolean) => {
  iosUserWantsSound = wants;
};

/** Get effective mute state for current platform */
export const getEffectiveMuted = (): boolean => {
  if (IS_IOS_WEB) return !iosUserWantsSound;
  return globalMuted;
};

/** Set mute state for current platform */
export const setEffectiveMuted = (muted: boolean) => {
  if (IS_IOS_WEB) {
    setIosUserWantsSound(!muted);
  } else {
    setGlobalMuted(muted);
  }
};
