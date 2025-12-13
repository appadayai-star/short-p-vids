import { useState, useMemo } from "react";
import { getBestThumbnailUrl, DEFAULT_PLACEHOLDER } from "@/lib/cloudinary";
import { AlertTriangle } from "lucide-react";

interface VideoThumbnailProps {
  cloudinaryPublicId: string | null;
  thumbnailUrl: string | null;
  videoUrl: string; // kept for API compatibility but NOT used
  title: string;
  videoId?: string;
  className?: string;
  showDebug?: boolean; // dev-only: show error overlay
}

/**
 * VideoThumbnail - NEVER loads a video element
 * Always renders an image with guaranteed fallback to placeholder
 */
export function VideoThumbnail({ 
  cloudinaryPublicId, 
  thumbnailUrl, 
  title,
  videoId,
  className = "w-full h-full object-cover",
  showDebug = false,
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Determine if this is using a real thumbnail or placeholder
  const hasRealThumbnail = !!(cloudinaryPublicId || thumbnailUrl);

  // Always get a valid image source - never undefined
  const imgSrc = useMemo(() => {
    if (imgError) {
      return DEFAULT_PLACEHOLDER;
    }
    return getBestThumbnailUrl(cloudinaryPublicId, thumbnailUrl);
  }, [cloudinaryPublicId, thumbnailUrl, imgError]);

  const isPlaceholder = imgSrc === DEFAULT_PLACEHOLDER;

  return (
    <div className="relative w-full h-full">
      <img
        src={imgSrc}
        alt={title}
        className={className}
        loading="lazy"
        onLoad={() => setImgLoaded(true)}
        onError={() => {
          if (!imgError) {
            console.warn(`[VideoThumbnail] Failed to load thumbnail for video ${videoId}:`, imgSrc);
            setImgError(true);
          }
        }}
      />
      
      {/* Show "processing" indicator when using placeholder */}
      {isPlaceholder && !imgError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/50 text-xs bg-black/40 px-2 py-1 rounded">
            Processing...
          </div>
        </div>
      )}

      {/* Dev-only: show error overlay if image failed to load (not for placeholders) */}
      {showDebug && imgError && hasRealThumbnail && (
        <div className="absolute top-1 right-1 bg-red-500/80 rounded p-1">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
    </div>
  );
}
