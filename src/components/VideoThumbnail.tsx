import { useState, useMemo } from "react";

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

export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  videoUrl, 
  title,
  videoId,
  className = "w-full h-full object-cover"
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);

  // Compute best thumbnail source
  const imgSrc = useMemo(() => {
    if (thumbnailUrl) return thumbnailUrl;
    if (cloudinaryPublicId) return getCloudinaryThumbnail(cloudinaryPublicId);
    return null;
  }, [thumbnailUrl, cloudinaryPublicId]);

  // If no image source or error, use video element to show first frame
  if (!imgSrc || imgError) {
    return (
      <video
        src={videoUrl}
        className={className}
        muted
        playsInline
        preload="metadata"
        style={{ objectFit: 'cover' }}
      />
    );
  }

  return (
    <img
      src={imgSrc}
      alt={title}
      className={className}
      loading="lazy"
      onError={() => {
        console.warn("Thumbnail load failed:", videoId, imgSrc);
        setImgError(true);
      }}
    />
  );
}
