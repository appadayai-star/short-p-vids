import { useState } from "react";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  title: string;
  videoId?: string;
  className?: string;
}

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u';

// Generate thumbnail from cloudinary public_id
function getCloudinaryThumbnail(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

// Generate thumbnail from video URL using Cloudinary fetch
function getCloudinaryFetchThumbnail(videoUrl: string): string {
  // Use base64 encoding for the URL to avoid special character issues
  const base64Url = btoa(videoUrl);
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_1/${base64Url}`;
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
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [fallbackLevel, setFallbackLevel] = useState(0);

  // Determine image source based on priority and fallback level
  useState(() => {
    if (thumbnailUrl) {
      setCurrentSrc(thumbnailUrl);
    } else if (cloudinaryPublicId) {
      setCurrentSrc(getCloudinaryThumbnail(cloudinaryPublicId));
    } else if (videoUrl) {
      setCurrentSrc(getCloudinaryFetchThumbnail(videoUrl));
    }
  });

  // Set initial source
  if (!currentSrc && !imgError) {
    if (thumbnailUrl) {
      setCurrentSrc(thumbnailUrl);
    } else if (cloudinaryPublicId) {
      setCurrentSrc(getCloudinaryThumbnail(cloudinaryPublicId));
    } else if (videoUrl) {
      setCurrentSrc(getCloudinaryFetchThumbnail(videoUrl));
    }
  }

  const handleImageError = () => {
    console.warn("Thumbnail failed:", videoId, fallbackLevel, currentSrc);
    
    // Try next fallback
    if (fallbackLevel === 0 && cloudinaryPublicId) {
      setCurrentSrc(getCloudinaryThumbnail(cloudinaryPublicId));
      setFallbackLevel(1);
    } else if (fallbackLevel <= 1 && videoUrl) {
      setCurrentSrc(getCloudinaryFetchThumbnail(videoUrl));
      setFallbackLevel(2);
    } else {
      setImgError(true);
    }
  };

  // If all image sources failed, show gradient fallback
  if (imgError || !currentSrc) {
    return (
      <div className={`${className} bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center`}>
        <div className="text-muted-foreground/50 text-xs text-center px-2">
          {title?.substring(0, 20) || 'Video'}
        </div>
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={title}
      className={className}
      loading="lazy"
      onError={handleImageError}
    />
  );
}