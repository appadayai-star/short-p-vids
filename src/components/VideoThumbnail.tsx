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

// Generate thumbnail from any video URL using Cloudinary fetch
function getCloudinaryFetchThumbnail(videoUrl: string): string {
  const encodedUrl = encodeURIComponent(videoUrl);
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${encodedUrl}`;
}

export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  videoUrl, 
  title,
  className = "w-full h-full object-cover"
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);

  // Determine thumbnail source with priority
  const getThumbnailSrc = (): string => {
    // Priority 1: Cloudinary generated from public_id
    if (cloudinaryPublicId) {
      return getCloudinaryThumbnail(cloudinaryPublicId);
    }
    // Priority 2: Stored thumbnail URL
    if (thumbnailUrl) {
      return thumbnailUrl;
    }
    // Priority 3: Generate via Cloudinary fetch from video URL
    return getCloudinaryFetchThumbnail(videoUrl);
  };

  const src = getThumbnailSrc();

  // If image failed, show video first frame
  if (imgError) {
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

  return (
    <img
      src={src}
      alt={title}
      className={className}
      loading="lazy"
      onError={() => setImgError(true)}
    />
  );
}
