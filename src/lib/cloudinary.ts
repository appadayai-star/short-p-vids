// Video URL generation utilities
// Hybrid: Cloudflare Stream (preferred) + Cloudinary (legacy fallback)
// Optimized for instant startup and mobile streaming

const CLOUDINARY_CLOUD_NAME = 'domj6omwb';

// Cloudflare Stream customer subdomain - extracted from first successful playback
// For now we use the iframe/videodelivery.net pattern for HLS
const CLOUDFLARE_CUSTOMER_SUBDOMAIN = 'customer-domj6omwb'; // placeholder until we know the real one

// Static placeholder for missing thumbnails - gradient placeholder
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// ===== CLOUDFLARE STREAM UTILITIES =====

// Get Cloudflare Stream HLS URL for native <video> playback
export function getCloudflareStreamUrl(cloudflareVideoId: string): string {
  return `https://customer-f33mdyre2vhg0apn.cloudflarestream.com/${cloudflareVideoId}/manifest/video.m3u8`;
}

// Get Cloudflare Stream MP4 download URL (fallback for non-HLS browsers)
export function getCloudflareDownloadUrl(cloudflareVideoId: string): string {
  return `https://customer-f33mdyre2vhg0apn.cloudflarestream.com/${cloudflareVideoId}/downloads/default.mp4`;
}

// Get Cloudflare Stream thumbnail
export function getCloudflareThumbnailUrl(cloudflareVideoId: string): string {
  return `https://customer-f33mdyre2vhg0apn.cloudflarestream.com/${cloudflareVideoId}/thumbnails/thumbnail.jpg?time=0s&height=852&width=480`;
}

// ===== CLOUDINARY UTILITIES (LEGACY) =====

export function getOptimizedVideoUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_auto,q_auto/${publicId}`;
}

export function getStreamUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${publicId}.m3u8`;
}

export function getThumbnailUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_pad,b_black,f_auto,q_auto,so_0/${publicId}.jpg`;
}

// Check if browser supports HLS natively (Safari, iOS)
export function supportsHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// ===== HYBRID VIDEO SOURCE LOGIC =====

// Get best video source - Cloudflare first, then Cloudinary fallback
// Priority: cloudflare_video_id > optimized_video_url > cloudinary_public_id > original
export function getBestVideoSource(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string,
  cloudflareVideoId?: string | null
): string {
  // 1. Cloudflare Stream (new, preferred)
  if (cloudflareVideoId) {
    // Use HLS for native support (Safari/iOS), MP4 download fallback otherwise
    if (supportsHlsNatively()) {
      return getCloudflareStreamUrl(cloudflareVideoId);
    }
    // For non-HLS browsers, use the MP4 download link
    return getCloudflareDownloadUrl(cloudflareVideoId);
  }

  // 2. Legacy Cloudinary logic
  const looksDynamicCloudinary = (url: string) => {
    if (!url.includes('res.cloudinary.com')) return false;
    return url.includes('f_auto') || url.includes('q_auto') || /\/upload\/[a-z0-9_,:]+\//i.test(url);
  };

  if (optimizedVideoUrl && !looksDynamicCloudinary(optimizedVideoUrl)) {
    return optimizedVideoUrl;
  }
  if (cloudinaryPublicId) {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${cloudinaryPublicId}.mp4`;
  }
  if (optimizedVideoUrl) {
    return optimizedVideoUrl;
  }
  return originalVideoUrl;
}

export type VideoSourceType = 'cloudflare' | 'optimized' | 'cloudinary' | 'original';

export function getVideoSourceCandidates(
  cloudinaryPublicId: string | null,
  optimizedVideoUrl: string | null,
  streamUrl: string | null,
  originalVideoUrl: string,
  cloudflareVideoId?: string | null
): Array<{ url: string; type: VideoSourceType }> {
  const seen = new Set<string>();
  const candidates: Array<{ url: string; type: VideoSourceType }> = [];

  const addCandidate = (url: string | null | undefined, type: VideoSourceType) => {
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, type });
  };

  // Cloudflare first
  if (cloudflareVideoId) {
    if (supportsHlsNatively()) {
      addCandidate(getCloudflareStreamUrl(cloudflareVideoId), 'cloudflare');
    }
    addCandidate(getCloudflareDownloadUrl(cloudflareVideoId), 'cloudflare');
  }

  // Then Cloudinary fallbacks
  const primary = getBestVideoSource(cloudinaryPublicId, optimizedVideoUrl, streamUrl, originalVideoUrl);
  const canonicalCloudinary = cloudinaryPublicId
    ? `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${cloudinaryPublicId}.mp4`
    : null;

  addCandidate(
    primary,
    primary === originalVideoUrl ? 'original' : primary === canonicalCloudinary ? 'cloudinary' : 'optimized'
  );
  addCandidate(canonicalCloudinary, 'cloudinary');
  addCandidate(optimizedVideoUrl, 'optimized');
  addCandidate(originalVideoUrl, 'original');

  return candidates;
}

// Get best thumbnail - Cloudflare first, then Cloudinary, then placeholder
export function getBestThumbnailUrl(
  cloudinaryPublicId: string | null,
  thumbnailUrl: string | null,
  cloudflareVideoId?: string | null
): string {
  if (cloudflareVideoId) {
    return getCloudflareThumbnailUrl(cloudflareVideoId);
  }
  if (cloudinaryPublicId) {
    return getThumbnailUrl(cloudinaryPublicId);
  }
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  return DEFAULT_PLACEHOLDER;
}

// Get optimized avatar URL — resize to small dimensions via Cloudinary or query params
export function getOptimizedAvatarUrl(avatarUrl: string | null, size: number = 80): string {
  if (!avatarUrl) return '';
  
  if (avatarUrl.includes('res.cloudinary.com')) {
    return avatarUrl.replace('/upload/', `/upload/w_${size},h_${size},c_fill,g_face,f_auto,q_auto/`);
  }
  
  if (avatarUrl.includes('supabase.co/storage')) {
    const separator = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${separator}width=${size}&height=${size}&resize=cover`;
  }
  
  return avatarUrl;
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
export function warmVideoSource(src: string): void {
  if (!src) return;
  // Don't actually make requests - just let video preload handle it
}
