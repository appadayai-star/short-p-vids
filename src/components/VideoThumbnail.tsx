import { useState, useMemo } from "react";
import { getBestThumbnailUrl, DEFAULT_PLACEHOLDER } from "@/lib/cloudinary";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string; // kept for API compatibility but NOT used
  title: string;
  videoId?: string;
  className?: string;
}

/**
 * VideoThumbnail - NEVER loads a video element
 * Always renders an image with guaranteed fallback to placeholder
 */
export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  title,
  className = "w-full h-full object-cover"
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);

  // Always get a valid image source - never undefined
  const imgSrc = useMemo(() => {
    if (imgError) {
      return DEFAULT_PLACEHOLDER;
    }
    return getBestThumbnailUrl(cloudinaryPublicId, thumbnailUrl);
  }, [cloudinaryPublicId, thumbnailUrl, imgError]);

  return (
    <img
      src={imgSrc}
      alt={title}
      className={className}
      loading="lazy"
      onError={() => {
        if (!imgError) {
          setImgError(true);
        }
      }}
    />
  );
}
