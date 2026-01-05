// Video utilities - SIMPLIFIED: Use Supabase storage directly
// Cloudinary public_ids in DB are placeholder paths that don't exist
// Debug logging helper - enabled via localStorage.videoDebug = '1'

export const isVideoDebug = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('videoDebug') === '1';
};

export const videoLog = (message: string, ...args: unknown[]): void => {
  if (isVideoDebug()) {
    console.log(`[Video] ${message}`, ...args);
  }
};

// Static placeholder for missing thumbnails
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// SIMPLE: Always use original video_url from Supabase storage
// The cloudinary_public_id values are placeholders that don't exist in Cloudinary
export function getBestVideoSource(
  _cloudinaryPublicId: string | null,
  _optimizedVideoUrl: string | null,
  _streamUrl: string | null,
  originalVideoUrl: string
): string {
  videoLog('Using video_url:', originalVideoUrl.substring(0, 60));
  return originalVideoUrl;
}

// Get best thumbnail - use stored thumbnail_url or placeholder
export function getBestThumbnailUrl(
  _cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string {
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  return DEFAULT_PLACEHOLDER;
}

// Preload an image (for warming next thumbnail) - fire and forget
export function preloadImage(src: string): void {
  if (!src || src === DEFAULT_PLACEHOLDER) return;
  try {
    const img = new Image();
    img.src = src;
  } catch {
    // Ignore - this is just warming
  }
}
