// Cloudinary URL generation utilities - SIMPLIFIED STABLE VERSION
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

// Static placeholder for missing thumbnails - gradient placeholder
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// STABLE BASELINE: Always use original video_url from Supabase storage
// Cloudinary transform URLs are failing with MEDIA_ERR_SRC_NOT_SUPPORTED
// We'll re-enable Cloudinary after confirming this baseline works
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): string {
  // ALWAYS use original video URL - Supabase storage is reliable
  // The optimized_video_url contains Cloudinary transforms that are failing
  videoLog('Using original video_url:', originalVideoUrl.substring(0, 80));
  return originalVideoUrl;
}

// Get best thumbnail - ALWAYS returns a valid image URL, never undefined
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string {
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  // Always return placeholder - never null/undefined
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
