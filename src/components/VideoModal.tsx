import { useEffect, useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VideoCard } from "./VideoCard";
import { toast } from "sonner";

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  user_id: string;
  tags: string[] | null;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialVideoId: string;
  userId: string | null;
  videos?: Video[];
}

export const VideoModal = ({ isOpen, onClose, initialVideoId, userId, videos: providedVideos }: VideoModalProps) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleActiveChange = useCallback((index: number, isActive: boolean) => {
    if (isActive) {
      setActiveIndex(index);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (providedVideos && providedVideos.length > 0) {
        setVideos(providedVideos);
        const index = providedVideos.findIndex(v => v.id === initialVideoId);
        const targetIndex = index >= 0 ? index : 0;
        setActiveIndex(targetIndex);
        setIsLoading(false);
        
        setTimeout(() => {
          if (scrollContainerRef.current) {
            const videoElements = scrollContainerRef.current.children;
            if (videoElements[targetIndex]) {
              videoElements[targetIndex].scrollIntoView({ behavior: 'instant', block: 'start' });
            }
          }
        }, 100);
      } else {
        fetchVideos();
      }
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, initialVideoId, providedVideos]);

  // Determine which videos should preload
  const shouldPreload = useCallback((index: number) => {
    return index >= activeIndex && index <= activeIndex + 2;
  }, [activeIndex]);

  const fetchVideos = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select(`
          id, title, description, video_url, optimized_video_url, thumbnail_url,
          views_count, likes_count, user_id, tags,
          profiles(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setVideos(data || []);
      const index = (data || []).findIndex(v => v.id === initialVideoId);
      setActiveIndex(index >= 0 ? index : 0);
    } catch (error) {
      console.error("Error fetching videos:", error);
      toast.error("Failed to load videos");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button
        onClick={onClose}
        className="fixed top-4 left-4 z-50 p-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      <div ref={scrollContainerRef} className="h-screen overflow-y-scroll snap-y snap-mandatory scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-primary text-lg">Loading...</div>
          </div>
        ) : (
          videos.map((video, index) => (
            <VideoCard 
              key={video.id} 
              video={video}
              index={index}
              currentUserId={userId}
              shouldPreload={shouldPreload(index)}
              isFirstVideo={index === 0}
              hasEntered={true}
              onActiveChange={handleActiveChange}
              onNavigate={onClose} 
            />
          ))
        )}
      </div>
    </div>
  );
};
