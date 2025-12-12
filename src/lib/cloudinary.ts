// Cloudinary URL generation utilities
// Generate dynamic transformation URLs from public_id

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u'; // Your cloud name

export function getOptimizedVideoUrl(publicId: string): string {
  // Progressive MP4 with quality optimization
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,q_auto:eco,c_limit,h_720,vc_h264,fps_30,br_2000k/${publicId}.mp4`;
}

export function getStreamUrl(publicId: string): string {
  // HLS adaptive streaming
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/sp_hd/${publicId}.m3u8`;
}

export function getThumbnailUrl(publicId: string): string {
  // Optimized thumbnail
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
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null
): string | undefined {
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
  }
  return thumbnailUrl || undefined;
}
