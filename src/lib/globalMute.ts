// Global mute state — shared across all playback surfaces (feed, modal, embed)
// Videos start muted by default (browser autoplay policy).
// When a user unmutes, ALL videos across the app play with sound.

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
