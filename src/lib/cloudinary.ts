// Video URL generation utilities — Cloudflare Stream only
// All videos are now hosted on Cloudflare Stream.
// Legacy Cloudinary code has been removed after full migration.

// Cloudflare Stream customer subdomain
const CLOUDFLARE_CUSTOMER_SUBDOMAIN = 'customer-qb7mect5e41byr1i';

// Static placeholder for missing thumbnails
export const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="852" viewBox="0 0 480 852"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0%25" y1="0%25" x2="0%25" y2="100%25"%3E%3Cstop offset="0%25" style="stop-color:%231a1a2e"%2F%3E%3Cstop offset="100%25" style="stop-color:%230f0f1a"%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect fill="url(%23g)" width="480" height="852"%2F%3E%3C%2Fsvg%3E';

// ===== CLOUDFLARE STREAM URLS =====

export function getCloudflareStreamUrl(cloudflareVideoId: string): string {
  return `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}.cloudflarestream.com/${cloudflareVideoId}/manifest/video.m3u8`;
}

export function getCloudflareDownloadUrl(cloudflareVideoId: string): string {
  return `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}.cloudflarestream.com/${cloudflareVideoId}/downloads/default.mp4`;
}

export function getCloudflareThumbnailUrl(cloudflareVideoId: string): string {
  return `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}.cloudflarestream.com/${cloudflareVideoId}/thumbnails/thumbnail.jpg?time=0s&height=852&width=480&fit=contain`;
}

// Check if browser supports HLS natively (Safari, iOS)
export function supportsHlsNatively(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// ===== VIDEO SOURCE =====

// Get video source from Cloudflare. Falls back to original video_url if no cloudflare_video_id.
export function getVideoSource(
  cloudflareVideoId: string | null | undefined,
  originalVideoUrl: string
): string {
  if (cloudflareVideoId) {
    return supportsHlsNatively()
      ? getCloudflareStreamUrl(cloudflareVideoId)
      : getCloudflareDownloadUrl(cloudflareVideoId);
  }
  // Safety fallback — should not happen post-migration
  console.warn('[getVideoSource] Missing cloudflare_video_id, falling back to original URL');
  return originalVideoUrl;
}

// ===== THUMBNAIL =====

export function getThumbnailUrl(
  cloudflareVideoId: string | null | undefined,
  thumbnailUrl: string | null | undefined
): string {
  if (cloudflareVideoId) {
    return getCloudflareThumbnailUrl(cloudflareVideoId);
  }
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  return DEFAULT_PLACEHOLDER;
}

// ===== AVATAR =====

export function getOptimizedAvatarUrl(avatarUrl: string | null, size: number = 80): string {
  if (!avatarUrl) return '';
  
  if (avatarUrl.includes('supabase.co/storage')) {
    const separator = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${separator}width=${size}&height=${size}&resize=cover`;
  }
  
  return avatarUrl;
}

// Preload an image (for warming next thumbnail)
export function preloadImage(src: string): void {
  if (!src || src === DEFAULT_PLACEHOLDER) return;
  try {
    const img = new Image();
    img.src = src;
  } catch {
    // Ignore
  }
}

// Check if a video is missing its Cloudflare ID (safety check)
export function isMissingCloudflare(cloudflareVideoId: string | null | undefined): boolean {
  return !cloudflareVideoId;
}
