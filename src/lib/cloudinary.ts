// Cloudinary URL generation utilities
// Debug logging helper - enabled via localStorage.videoDebug = '1'

const CLOUDINARY_CLOUD_NAME = 'domj6omwb';

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

// Generate optimized Cloudinary video URL from public_id
// Simple transform: MP4, H.264, 720p max, faststart for instant playback
function generateCloudinaryUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,vc_h264,c_limit,h_720,q_auto,fl_faststart/${publicId}.mp4`;
}

// Get best video source with proper fallback chain:
// 1. optimized_video_url (pre-generated, fastest)
// 2. Generate from cloudinary_public_id (on-demand transform)
// 3. Original video_url (Supabase storage, slowest)
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): string {
  // Priority 1: Use pre-optimized URL if available (already transformed and cached)
  if (optimizedVideoUrl) {
    videoLog('Using optimized_video_url:', optimizedVideoUrl.substring(0, 80));
    return optimizedVideoUrl;
  }
  
  // Priority 2: Generate URL from cloudinary_public_id
  if (cloudinaryPublicId) {
    const url = generateCloudinaryUrl(cloudinaryPublicId);
    videoLog('Generated Cloudinary URL:', url.substring(0, 80));
    return url;
  }
  
  // Priority 3: Fall back to original (Supabase storage)
  videoLog('Using original video_url:', originalVideoUrl.substring(0, 80));
  return originalVideoUrl;
}

// Get thumbnail URL
export function getThumbnailUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

// Get best thumbnail - ALWAYS returns a valid image URL, never undefined
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string {
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
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
