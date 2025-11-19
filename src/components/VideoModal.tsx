import { useEffect, useState, useCallback, useRef } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VideoCard } from "./VideoCard";
import { toast } from "sonner";

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
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
  videos?: Video[]; // Optional: use provided videos instead of fetching
}

export const VideoModal = ({ isOpen, onClose, initialVideoId, userId, videos: providedVideos }: VideoModalProps) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (providedVideos && providedVideos.length > 0) {
        // Use provided videos (e.g., from search results)
        setVideos(providedVideos);
        const index = providedVideos.findIndex(v => v.id === initialVideoId);
        const targetIndex = index >= 0 ? index : 0;
        setCurrentIndex(targetIndex);
        setIsLoading(false);
        
        // Scroll to the selected video after render
        setTimeout(() => {
          if (scrollContainerRef.current) {
            const videoElements = scrollContainerRef.current.children;
            if (videoElements[targetIndex]) {
              videoElements[targetIndex].scrollIntoView({ behavior: 'instant', block: 'start' });
            }
          }
        }, 100);
      } else {
        // Fetch all videos
        fetchVideos();
      }
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, initialVideoId, providedVideos]);

  const fetchVideos = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select(`
          id,
          title,
          description,
          video_url,
          thumbnail_url,
          views_count,
          likes_count,
          comments_count,
          user_id,
          tags,
          profiles!inner(username, avatar_url)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setVideos(data || []);
      
      // Find the index of the initial video
      const index = (data || []).findIndex(v => v.id === initialVideoId);
      setCurrentIndex(index >= 0 ? index : 0);
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
      {/* Close button */}
      <button
        onClick={onClose}
        className="fixed top-4 left-4 z-50 p-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Video scroll container */}
      <div ref={scrollContainerRef} className="h-screen overflow-y-scroll snap-y snap-mandatory">
        {isLoading ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-primary text-lg">Loading...</div>
          </div>
        ) : (
          videos.map((video, index) => (
            <div key={video.id} className="snap-start">
              <VideoCard video={video} currentUserId={userId} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
