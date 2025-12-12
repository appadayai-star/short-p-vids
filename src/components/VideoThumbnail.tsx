import { useState } from "react";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  title: string;
  className?: string;
}

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u';

// Generate thumbnail from cloudinary public_id
function getCloudinaryThumbnail(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  videoUrl, 
  title,
  className = "w-full h-full object-cover"
}: VideoThumbnailProps) {
  const [useFallback, setUseFallback] = useState(false);

  // Priority 1: Cloudinary generated thumbnail
  if (cloudinaryPublicId && !useFallback) {
    return (
      <img
        src={getCloudinaryThumbnail(cloudinaryPublicId)}
        alt={title}
        className={className}
        loading="lazy"
        onError={() => setUseFallback(true)}
      />
    );
  }

  // Priority 2: Stored thumbnail URL
  if (thumbnailUrl && !useFallback) {
    return (
      <img
        src={thumbnailUrl}
        alt={title}
        className={className}
        loading="lazy"
        onError={() => setUseFallback(true)}
      />
    );
  }

  // Fallback: Use video element to show first frame
  return (
    <video
      src={videoUrl}
      className={className}
      muted
      playsInline
      preload="metadata"
    />
  );
}
