// Video utilities - STABLE SOURCE SELECTION
// Only use verified optimized_video_url, never generate from cloudinary_public_id alone
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

/**
 * STABLE SOURCE SELECTION POLICY:
 * 
 * 1. If optimized_video_url exists → use it (verified Cloudinary URL)
 * 2. Otherwise → use original video_url from Supabase storage
 * 
 * IMPORTANT: We do NOT generate URLs from cloudinary_public_id because
 * many videos have placeholder public_ids that don't actually exist on Cloudinary.
 * Only optimized_video_url is set after a verified successful upload.
 */
export function getBestVideoSource(
  _cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  _streamUrl: string | null,
  originalVideoUrl: string
): string {
  // Priority 1: Use optimized_video_url if available (verified Cloudinary upload)
  if (optimizedVideoUrl) {
    videoLog('Using optimized_video_url:', optimizedVideoUrl.substring(0, 80));
    return optimizedVideoUrl;
  }
  
  // Priority 2: Fallback to original Supabase storage URL
  videoLog('Using video_url (Supabase):', originalVideoUrl.substring(0, 60));
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
