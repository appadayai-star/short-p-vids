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
}): string | null {
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
  return null;
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
  const [retryCount, setRetryCount] = useState(0);

  // Reset error state when props change
  useEffect(() => {
    setImgError(false);
    setRetryCount(0);
  }, [thumbnailUrl, cloudinaryPublicId, videoUrl]);

  const primarySrc = getBestThumbnail({ 
    thumbnail_url: thumbnailUrl, 
    cloudinary_public_id: cloudinaryPublicId, 
    video_url: videoUrl 
  });
  
  // Debug logging for production issues
  useEffect(() => {
    if (!thumbnailUrl && !cloudinaryPublicId) {
      console.warn("Missing thumbnail data", videoId || title, { thumbnailUrl, cloudinaryPublicId, videoUrl });
    }
  }, [thumbnailUrl, cloudinaryPublicId, videoUrl, videoId, title]);

  // Handle image load error with retry logic
  const handleError = () => {
    if (retryCount < 2) {
      setRetryCount(prev => prev + 1);
    } else {
      setImgError(true);
    }
  };

  // If all image attempts failed, show gradient placeholder
  if (imgError || !primarySrc) {
    return (
      <div 
        className={`${className} bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center`}
        title={title}
      >
        <span className="text-white/30 text-xs text-center px-2">
          {title?.substring(0, 20) || 'Video'}
        </span>
      </div>
    );
  }

  return (
    <img
      key={`${primarySrc}-${retryCount}`}
      src={primarySrc}
      alt={title}
      className={className}
      loading="lazy"
      onError={handleError}
    />
  );
}