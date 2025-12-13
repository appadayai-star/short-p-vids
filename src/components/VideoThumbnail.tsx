import { useState, useEffect, useRef } from "react";

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
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [useVideoFrame, setUseVideoFrame] = useState(false);
  const [videoFrameReady, setVideoFrameReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Reset state when video changes
    setUseVideoFrame(false);
    setVideoFrameReady(false);
    
    // Priority 1: Stored thumbnail URL
    if (thumbnailUrl) {
      setImgSrc(thumbnailUrl);
      return;
    }
    
    // Priority 2: Cloudinary generated from public_id
    if (cloudinaryPublicId) {
      setImgSrc(getCloudinaryThumbnail(cloudinaryPublicId));
      return;
    }
    
    // Priority 3: Extract frame from video
    setUseVideoFrame(true);
    setImgSrc(null);
  }, [thumbnailUrl, cloudinaryPublicId, videoUrl]);

  // Extract first frame from video
  useEffect(() => {
    if (!useVideoFrame || !videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    const handleLoadedData = () => {
      try {
        canvas.width = video.videoWidth || 480;
        canvas.height = video.videoHeight || 852;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setVideoFrameReady(true);
        }
      } catch (e) {
        console.warn("Failed to extract video frame:", e);
      }
    };
    
    video.addEventListener('loadeddata', handleLoadedData);
    
    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [useVideoFrame]);

  const handleImageError = () => {
    // If image fails, fallback to video frame extraction
    setUseVideoFrame(true);
    setImgSrc(null);
  };

  // Use video frame extraction
  if (useVideoFrame) {
    return (
      <div className={`${className} relative bg-gradient-to-br from-gray-700 to-gray-900`}>
        {/* Hidden video for frame extraction */}
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          className="hidden"
        />
        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className={videoFrameReady ? className : "hidden"} />
        
        {/* Fallback gradient while loading */}
        {!videoFrameReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  // Use image source
  if (imgSrc) {
    return (
      <img
        src={imgSrc}
        alt={title}
        className={className}
        loading="lazy"
        onError={handleImageError}
      />
    );
  }

  // Loading state
  return (
    <div className={`${className} bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center`}>
      <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
    </div>
  );
}