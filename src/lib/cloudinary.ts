// Cloudinary URL generation utilities
// Generate dynamic transformation URLs from public_id
// Optimized for instant startup and mobile streaming

const CLOUDINARY_CLOUD_NAME = 'domj6omwb';

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

// Optimized Cloudinary video URL with faststart and bitrate cap
// Stable transform for cache hits: H.264, 720p max, 1500kbps, faststart
export function getOptimizedVideoUrl(publicId: string): string {
  // fl_faststart = moov atom at beginning for instant playback
  // br_1500k = bitrate cap for fast loading
  // vc_h264 = H.264 codec for universal support
  // c_limit,h_720 = limit height to 720p
  // f_mp4 = force MP4 container
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,vc_h264,c_limit,h_720,br_1500k,fl_faststart/${publicId}`;
}

// HLS adaptive streaming URL for Safari/iOS
export function getStreamUrl(publicId: string): string {
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

// Get best video source for playback
// Priority: Cloudinary (with HLS for Safari) > optimized_video_url > original
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string
): string {
  // If we have a Cloudinary public ID, use Cloudinary delivery
  if (cloudinaryPublicId) {
    // For Safari/iOS, try HLS first for adaptive streaming
    if (supportsHlsNatively() && streamUrl) {
      videoLog('Using HLS stream:', streamUrl);
      return streamUrl;
    }
    
    // Otherwise use optimized MP4 with faststart
    const cloudinaryUrl = getOptimizedVideoUrl(cloudinaryPublicId);
    videoLog('Using Cloudinary MP4:', cloudinaryUrl);
    return cloudinaryUrl;
  }
  
  // Fallback to pre-optimized URL if available
  if (optimizedVideoUrl) {
    videoLog('Using optimized URL:', optimizedVideoUrl);
    return optimizedVideoUrl;
  }
  
  // Last resort: original video URL
  videoLog('Using original URL:', originalVideoUrl);
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
