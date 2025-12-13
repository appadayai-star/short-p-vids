// Cloudinary URL generation utilities
// Generate dynamic transformation URLs from public_id
// Optimized for instant startup and mobile streaming

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u'; // Your cloud name

export function getOptimizedVideoUrl(publicId: string): string {
  // Progressive MP4 optimized for instant startup:
  // - f_mp4: MP4 container
  // - q_auto:eco: Quality auto with eco profile (smaller file)
  // - c_limit,h_720: Max 720p height
  // - vc_h264: H.264 codec for compatibility
  // - fps_30: Max 30fps
  // - br_1500k: 1.5 Mbps bitrate for mobile (was 2000k)
  // - fl_faststart: Moves moov atom to front for instant playback
  // - ac_aac: AAC audio codec
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,q_auto:eco,c_limit,h_720,vc_h264,fps_30,br_1500k,fl_faststart,ac_aac/${publicId}.mp4`;
}

export function getStreamUrl(publicId: string): string {
  // HLS adaptive streaming with optimized profile
  // sp_hd provides multiple quality levels for adaptive playback
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/sp_hd/${publicId}.m3u8`;
}

export function getThumbnailUrl(publicId: string): string {
  // Optimized thumbnail - quick to load
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_auto,q_auto,so_0/${publicId}.jpg`;
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
    // Prefer HLS on Safari/iOS for adaptive streaming
    if (supportsHlsNatively()) {
      return getStreamUrl(cloudinaryPublicId);
    }
    // Use optimized MP4 for other browsers
    return getOptimizedVideoUrl(cloudinaryPublicId);
  }
  
  // Fallback to stored URLs (legacy videos before this change)
  if (supportsHlsNatively() && streamUrl) {
    return streamUrl;
  }
  if (optimizedVideoUrl) {
    return optimizedVideoUrl;
  }
  
  // Final fallback to original
  return originalVideoUrl;
}

// Get best thumbnail source
// Returns undefined if no reliable thumbnail available (will fall back to video element)
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null,
  _videoUrl?: string | null
): string | undefined {
  // Only use reliable sources - cloudinary public_id or stored thumbnail_url
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
  }
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  // Don't use Cloudinary fetch for external URLs - it often fails and causes broken images
  // Return undefined to let the component fall back to video element
  return undefined;
}
