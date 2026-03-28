import { useState, useMemo } from "react";
import { getThumbnailUrl, DEFAULT_PLACEHOLDER } from "@/lib/cloudinary";
import { AlertTriangle } from "lucide-react";

interface VideoThumbnailProps {
  cloudflareVideoId?: string | null;
  cloudinaryPublicId?: string | null; // kept for API compat, ignored
  thumbnailUrl: string | null;
  videoUrl?: string;
  title: string;
  videoId?: string;
  className?: string;
  showDebug?: boolean;
}

/**
 * VideoThumbnail - NEVER loads a video element
 * Always renders an image with guaranteed fallback to placeholder
 */
export function VideoThumbnail({ 
  cloudflareVideoId,
  thumbnailUrl, 
  title,
  videoId,
  className = "w-full h-full object-cover",
  showDebug = false,
}: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const hasRealThumbnail = !!(cloudflareVideoId || thumbnailUrl);

  const imgSrc = useMemo(() => {
    if (imgError) {
      return DEFAULT_PLACEHOLDER;
    }
    return getThumbnailUrl(cloudflareVideoId, thumbnailUrl);
  }, [cloudflareVideoId, thumbnailUrl, imgError]);

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
      
      {isPlaceholder && !imgError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/50 text-xs bg-black/40 px-2 py-1 rounded">
            Processing...
          </div>
        </div>
      )}

      {showDebug && imgError && hasRealThumbnail && (
        <div className="absolute top-1 right-1 bg-destructive/80 rounded p-1">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
    </div>
  );
}
