// Cloudinary URL generation utilities
// Prioritize pre-generated URLs for instant playback without cache misses

const CLOUDINARY_CLOUD_NAME = 'domj6omwb';

// Static placeholder for missing thumbnails - gradient placeholder
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// Fallback video URL generator (only used if optimized_video_url is missing)
// Uses the same canonical transform as process-video for consistency
export function getOptimizedVideoUrl(publicId: string): string {
  const cleanId = publicId.replace(/\.(mp4|mov|webm)$/i, '');
  // CANONICAL_TRANSFORM must match process-video edge function exactly
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,vc_h264,ac_aac,c_limit,h_720,fps_30,br_1200k,q_auto:eco,fl_faststart/${cleanId}.mp4`;
}

// HLS adaptive streaming for mobile (optional, not currently used)
export function getStreamUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/sp_hd/${publicId}.m3u8`;
}

// Optimized thumbnail from first frame
export function getThumbnailUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

// Check if browser supports HLS natively (Safari, iOS)
export function supportsHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// Get best video source for playback
// Priority: optimized_video_url (pre-generated) > cloudinary fallback > supabase original
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): { url: string; type: 'optimized' | 'cloudinary' | 'supabase' } {
  // FIRST PRIORITY: Pre-generated optimized URL (instant, no cache miss)
  if (optimizedVideoUrl) {
    return { url: optimizedVideoUrl, type: 'optimized' };
  }
  
  // SECOND PRIORITY: Generate URL from public_id (may have cache miss on first request)
  if (cloudinaryPublicId) {
    return { url: getOptimizedVideoUrl(cloudinaryPublicId), type: 'cloudinary' };
  }
  
  // LAST RESORT: Original Supabase URL (slow, unoptimized)
  return { url: originalVideoUrl, type: 'supabase' };
}

// Get best thumbnail - ALWAYS returns a valid image URL, never undefined
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string {
  // Prefer stored thumbnail URL
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  // Fallback to generated from public_id
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
  }
  return DEFAULT_PLACEHOLDER;
}

// Preload an image (for warming next thumbnail)
export function preloadImage(src: string): void {
  if (!src || src === DEFAULT_PLACEHOLDER) return;
  try {
    const img = new Image();
    img.src = src;
  } catch {
    // Ignore - just warming
  }
}

// Warm up a video URL with HEAD request (no-cors for cross-origin)
export async function warmupVideoUrl(url: string): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors' });
  } catch {
    // Ignore - just warming CDN cache
  }
}

// Get Cloudinary base URL for preconnect
export function getCloudinaryBaseUrl(): string {
  return `https://res.cloudinary.com`;
}
