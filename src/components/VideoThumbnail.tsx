import { useState, useEffect } from "react";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  title: string;
  videoId?: string; // For debugging
  className?: string;
}

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u';

// Generate thumbnail from cloudinary public_id
function getCloudinaryThumbnail(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

// Generate thumbnail from any video URL using Cloudinary fetch
function getCloudinaryFetchThumbnail(videoUrl: string): string {
  const encodedUrl = encodeURIComponent(videoUrl);
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${encodedUrl}`;
}

// Centralized thumbnail logic - exported for use elsewhere
export function getBestThumbnail(video: {
  thumbnail_url?: string | null;
  cloudinary_public_id?: string | null;
  video_url?: string;
}): string {
  // Priority 1: Stored thumbnail URL (most reliable if exists)
  if (video.thumbnail_url) {
    return video.thumbnail_url;
  }
  // Priority 2: Cloudinary generated from public_id
  if (video.cloudinary_public_id) {
    return getCloudinaryThumbnail(video.cloudinary_public_id);
  }
  // Priority 3: Generate via Cloudinary fetch from video URL
  if (video.video_url) {
    return getCloudinaryFetchThumbnail(video.video_url);
  }
  // Fallback: gradient placeholder (never null)
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 852"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:%23374151"/><stop offset="100%" style="stop-color:%231f2937"/></linearGradient></defs><rect fill="url(%23g)" width="480" height="852"/></svg>';
}

export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  videoUrl, 
  title,
  videoId,
  className = "w-full h-full object-cover"
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string>('');

  useEffect(() => {
    // Reset error state when props change
    setImgError(false);
    
    const src = getBestThumbnail({ 
      thumbnail_url: thumbnailUrl, 
      cloudinary_public_id: cloudinaryPublicId, 
      video_url: videoUrl 
    });
    
    // Debug logging for production issues
    if (!thumbnailUrl && !cloudinaryPublicId) {
      console.warn("Missing thumbnail data", videoId || title, { thumbnailUrl, cloudinaryPublicId, videoUrl });
    }
    
    setCurrentSrc(src);
  }, [thumbnailUrl, cloudinaryPublicId, videoUrl, videoId, title]);

  // If primary image failed, try cloudinary fetch as fallback
  const handleError = () => {
    if (!imgError && videoUrl) {
      setImgError(true);
      // Try cloudinary fetch as last resort
      setCurrentSrc(getCloudinaryFetchThumbnail(videoUrl));
    }
  };

  return (
    <img
      src={currentSrc}
      alt={title}
      className={className}
      loading="lazy"
      onError={handleError}
    />
  );
}