// Cloudinary URL generation utilities
// Generate dynamic transformation URLs from public_id
// Optimized for instant startup and mobile streaming

const CLOUDINARY_CLOUD_NAME = 'domj6omwb';

// Static placeholder for missing thumbnails - gradient placeholder
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// Debug mode - set via localStorage: localStorage.setItem('videoDebug', '1')
const isDebugMode = () => typeof window !== 'undefined' && localStorage.getItem('videoDebug') === '1';

// Video source selection result with debug info
export interface VideoSourceResult {
  url: string;
  sourceHost: 'cloudinary' | 'cloudinary-hls' | 'supabase' | 'fallback';
  isFallback: boolean;
  reason?: string;
}

export function getOptimizedVideoUrl(publicId: string): string {
  // Optimized MP4 with faststart, capped bitrate for mobile
  // fl_faststart ensures moov atom at start for instant playback
  // br_1500k caps bitrate for faster loading
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,q_auto,fl_faststart,br_1500k/${publicId}`;
}

export function getStreamUrl(publicId: string): string {
  // HLS adaptive streaming for Safari/iOS
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/sp_auto/${publicId}.m3u8`;
}

export function getThumbnailUrl(publicId: string): string {
  // Optimized thumbnail from Cloudinary
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_auto,q_auto,so_0/${publicId}.jpg`;
}

// Check if browser supports HLS natively (Safari, iOS)
export function supportsHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// Get best video source for playback with debug info
// Priority: 1) Cloudinary HLS (Safari), 2) Cloudinary MP4, 3) Supabase fallback
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): string {
  const result = getBestVideoSourceWithDebug(cloudinaryPublicId, optimizedVideoUrl, streamUrl, originalVideoUrl);
  return result.url;
}

export function getBestVideoSourceWithDebug(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): VideoSourceResult {
  // If we have a Cloudinary public ID, prefer Cloudinary URLs
  if (cloudinaryPublicId) {
    // For Safari/iOS, use HLS for adaptive streaming
    if (supportsHlsNatively()) {
      const hlsUrl = getStreamUrl(cloudinaryPublicId);
      if (isDebugMode()) {
        console.log('[Cloudinary] Using HLS for Safari:', hlsUrl);
      }
      return {
        url: hlsUrl,
        sourceHost: 'cloudinary-hls',
        isFallback: false,
        reason: 'HLS for Safari/iOS'
      };
    }
    
    // For other browsers, use optimized MP4 with faststart
    const mp4Url = getOptimizedVideoUrl(cloudinaryPublicId);
    if (isDebugMode()) {
      console.log('[Cloudinary] Using optimized MP4:', mp4Url);
    }
    return {
      url: mp4Url,
      sourceHost: 'cloudinary',
      isFallback: false,
      reason: 'Cloudinary MP4 with faststart'
    };
  }
  
  // No Cloudinary ID - fall back to Supabase/original URL
  const fallbackUrl = originalVideoUrl;
  if (isDebugMode()) {
    console.log('[Cloudinary] Fallback to Supabase:', fallbackUrl, '(no cloudinary_public_id)');
  }
  return {
    url: fallbackUrl,
    sourceHost: 'supabase',
    isFallback: true,
    reason: 'No cloudinary_public_id available'
  };
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
