// Cloudinary URL generation utilities
// Generate dynamic transformation URLs from public_id
// Optimized for instant startup and mobile streaming

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u';

// Static placeholder for missing thumbnails - gradient placeholder
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

export function getOptimizedVideoUrl(publicId: string): string {
  // Progressive MP4 optimized for instant startup
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,q_auto:eco,c_limit,h_720,vc_h264,fps_30,br_1500k,fl_faststart,ac_aac/${publicId}.mp4`;
}

export function getStreamUrl(publicId: string): string {
  // HLS adaptive streaming
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/sp_hd/${publicId}.m3u8`;
}

export function getThumbnailUrl(publicId: string): string {
  // Optimized thumbnail from Cloudinary
  const url = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_auto,q_auto,so_0/${publicId}.jpg`;
  // Debug: log the first generated URL
  if (typeof window !== 'undefined' && !(window as any).__thumbnailLogged) {
    console.log('[Cloudinary] Generated thumbnail URL:', url);
    (window as any).__thumbnailLogged = true;
  }
  return url;
}

// Check if browser supports HLS natively (Safari, iOS)
export function supportsHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// Get best video source for playback
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): string {
  // If we have a cloudinary public_id, generate dynamic URLs
  if (cloudinaryPublicId) {
    if (supportsHlsNatively()) {
      return getStreamUrl(cloudinaryPublicId);
    }
    return getOptimizedVideoUrl(cloudinaryPublicId);
  }
  
  // Fallback to stored URLs (legacy videos)
  if (supportsHlsNatively() && streamUrl) {
    return streamUrl;
  }
  if (optimizedVideoUrl) {
    return optimizedVideoUrl;
  }
  
  return originalVideoUrl;
}

// Get best thumbnail - ALWAYS returns a valid image URL, never undefined
// Priority: 1) cloudinary_public_id, 2) thumbnail_url, 3) placeholder
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string {
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
  }
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

// Warm video source - completely non-blocking, never throws
// Using Image instead of fetch to avoid CORS issues
export function warmVideoSource(src: string): void {
  if (!src) return;
  // Don't actually make requests - just let video preload handle it
  // Previous HEAD requests caused CORS issues
}
