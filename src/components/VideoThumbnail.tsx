import { useState } from "react";
import { getBestThumbnailUrl } from "@/lib/cloudinary";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  title: string;
  className?: string;
}

const CLOUDINARY_CLOUD_NAME = 'dsxmzxb4u';

// Generate a thumbnail from any video URL using Cloudinary's fetch feature
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
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Priority: cloudinary dynamic thumbnail > stored thumbnail > cloudinary fetch > video poster
  const primaryThumbnail = getBestThumbnailUrl(cloudinaryPublicId, thumbnailUrl);
  
  // Fallback: use Cloudinary fetch to generate thumbnail from video URL
  const fallbackThumbnail = getCloudinaryFetchThumbnail(videoUrl);

  const handleImageError = () => {
    setImageError(true);
    setIsLoading(false);
  };

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  // If primary thumbnail exists and hasn't errored, use it
  if (primaryThumbnail && !imageError) {
    return (
      <>
        {isLoading && (
          <div className="absolute inset-0 bg-white/10 animate-pulse" />
        )}
        <img
          src={primaryThumbnail}
          alt={title}
          className={className}
          loading="lazy"
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      </>
    );
  }

  // Fallback: use Cloudinary fetch thumbnail
  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 bg-white/10 animate-pulse" />
      )}
      <img
        src={fallbackThumbnail}
        alt={title}
        className={className}
        loading="lazy"
        onError={() => setIsLoading(false)}
        onLoad={handleImageLoad}
      />
    </>
  );
}
