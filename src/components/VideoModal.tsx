import { useEffect, useState, useRef, useCallback } from "react";
import { X, Heart, Share2, Bookmark, Volume2, VolumeX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";
import { ShareDrawer } from "./ShareDrawer";

// Global mute state
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();
const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(listener => listener(muted));
};

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
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
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const [savedVideos, setSavedVideos] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const isScrollingRef = useRef(false);

  // Sync with global mute
  useEffect(() => {
    const listener = (muted: boolean) => setIsMuted(muted);
    muteListeners.add(listener);
    return () => { muteListeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (providedVideos && providedVideos.length > 0) {
        setVideos(providedVideos);
        const counts: Record<string, number> = {};
        providedVideos.forEach(v => counts[v.id] = v.likes_count);
        setLikeCounts(counts);
        
        const index = providedVideos.findIndex(v => v.id === initialVideoId);
        const targetIndex = index >= 0 ? index : 0;
        setActiveIndex(targetIndex);
        setIsLoading(false);
        
        setTimeout(() => {
          scrollToIndex(targetIndex);
        }, 50);
      } else {
        fetchVideos();
      }
      document.body.style.overflow = 'hidden';
      fetchUserInteractions();
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen, initialVideoId, providedVideos]);

  // Auto-play active video
  useEffect(() => {
    videos.forEach((video, index) => {
      const videoEl = videoRefs.current.get(video.id);
      if (!videoEl) return;
      
      if (index === activeIndex) {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    });
  }, [activeIndex, videos]);

  const scrollToIndex = (index: number) => {
    if (scrollContainerRef.current) {
      const height = window.innerHeight;
      scrollContainerRef.current.scrollTo({ top: index * height, behavior: 'instant' });
    }
  };

  const fetchVideos = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select(`id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, thumbnail_url, views_count, likes_count, user_id, tags, profiles(username, avatar_url)`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setVideos(data || []);
      const counts: Record<string, number> = {};
      (data || []).forEach(v => counts[v.id] = v.likes_count);
      setLikeCounts(counts);
      
      const index = (data || []).findIndex(v => v.id === initialVideoId);
      setActiveIndex(index >= 0 ? index : 0);
    } catch (error) {
      console.error("Error fetching videos:", error);
      toast.error("Failed to load videos");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserInteractions = async () => {
    if (!userId) return;
    try {
      const [likesRes, savesRes] = await Promise.all([
        supabase.from("likes").select("video_id").eq("user_id", userId),
        supabase.from("saved_videos").select("video_id").eq("user_id", userId)
      ]);
      
      if (likesRes.data) setLikedVideos(new Set(likesRes.data.map(l => l.video_id)));
      if (savesRes.data) setSavedVideos(new Set(savesRes.data.map(s => s.video_id)));
    } catch (error) {
      console.error("Error fetching interactions:", error);
    }
  };

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollingRef.current) return;
    
    const container = e.currentTarget;
    const scrollTop = container.scrollTop;
    const height = window.innerHeight;
    const newIndex = Math.round(scrollTop / height);
    
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex);
    }
  }, [activeIndex, videos.length]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isScrollingRef.current) return;
    
    const direction = e.deltaY > 0 ? 1 : -1;
    const newIndex = Math.max(0, Math.min(videos.length - 1, activeIndex + direction));
    
    if (newIndex !== activeIndex) {
      isScrollingRef.current = true;
      setActiveIndex(newIndex);
      scrollToIndex(newIndex);
      setTimeout(() => { isScrollingRef.current = false; }, 400);
    }
  }, [activeIndex, videos.length]);

  const toggleMute = () => {
    setGlobalMuted(!isMuted);
  };

  const toggleLike = async (videoId: string) => {
    const wasLiked = likedVideos.has(videoId);
    
    // Optimistic update
    setLikedVideos(prev => {
      const next = new Set(prev);
      wasLiked ? next.delete(videoId) : next.add(videoId);
      return next;
    });
    setLikeCounts(prev => ({
      ...prev,
      [videoId]: (prev[videoId] || 0) + (wasLiked ? -1 : 1)
    }));

    try {
      await supabase.functions.invoke('like-video', {
        body: { videoId, clientId: userId, action: wasLiked ? 'unlike' : 'like' }
      });
    } catch {
      // Revert on error
      setLikedVideos(prev => {
        const next = new Set(prev);
        wasLiked ? next.add(videoId) : next.delete(videoId);
        return next;
      });
      setLikeCounts(prev => ({
        ...prev,
        [videoId]: (prev[videoId] || 0) + (wasLiked ? 1 : -1)
      }));
      toast.error("Failed to update like");
    }
  };

  const toggleSave = async (videoId: string) => {
    if (!userId) {
      navigate("/auth");
      return;
    }
    
    const wasSaved = savedVideos.has(videoId);
    
    setSavedVideos(prev => {
      const next = new Set(prev);
      wasSaved ? next.delete(videoId) : next.add(videoId);
      return next;
    });

    try {
      if (wasSaved) {
        await supabase.from("saved_videos").delete().eq("video_id", videoId).eq("user_id", userId);
        toast.success("Removed from saved");
      } else {
        await supabase.from("saved_videos").insert({ video_id: videoId, user_id: userId });
        toast.success("Saved");
      }
    } catch {
      setSavedVideos(prev => {
        const next = new Set(prev);
        wasSaved ? next.add(videoId) : next.delete(videoId);
        return next;
      });
      toast.error("Failed to save video");
    }
  };

  if (!isOpen) return null;

  const activeVideo = videos[activeIndex];

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button
        onClick={onClose}
        className="fixed top-4 left-4 z-50 p-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      <div 
        ref={scrollContainerRef} 
        className="h-screen overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-primary text-lg">Loading...</div>
          </div>
        ) : (
          videos.map((video, index) => {
            const videoSrc = getBestVideoSource(
              video.cloudinary_public_id || null,
              video.optimized_video_url || null,
              video.stream_url || null,
              video.video_url
            );
            const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);
            const isActive = index === activeIndex;
            const isNearby = Math.abs(index - activeIndex) <= 1;

            return (
              <div key={video.id} className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center">
                {/* Poster/Thumbnail */}
                {posterSrc && (
                  <img 
                    src={posterSrc} 
                    alt="" 
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ opacity: isActive ? 0 : 1 }}
                  />
                )}

                {/* Video - only load nearby videos */}
                {isNearby && (
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(video.id, el);
                    }}
                    src={videoSrc}
                    poster={posterSrc || undefined}
                    className="absolute inset-0 w-full h-full object-contain"
                    loop
                    muted={isMuted}
                    playsInline
                    preload={isActive ? "auto" : "metadata"}
                    onClick={toggleMute}
                  />
                )}

                {/* Mute button */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                  className="absolute bottom-24 right-4 p-2 bg-black/50 rounded-full z-10"
                >
                  {isMuted ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-white" />}
                </button>

                {/* Caption overlay */}
                <div className="absolute bottom-20 left-4 right-16 z-10 pointer-events-none">
                  <div 
                    className="flex items-center gap-2 mb-2 pointer-events-auto cursor-pointer"
                    onClick={() => { onClose(); navigate(`/profile/${video.user_id}`); }}
                  >
                    {video.profiles?.avatar_url ? (
                      <img src={video.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                        {video.profiles?.username?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    <span className="text-white font-semibold text-sm">@{video.profiles?.username}</span>
                  </div>
                  <p className="text-white text-sm drop-shadow-lg">{video.description}</p>
                  {video.tags && video.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 pointer-events-auto">
                      {video.tags.map((tag, i) => (
                        <span 
                          key={i} 
                          className="text-white/80 text-xs cursor-pointer hover:text-white"
                          onClick={() => { onClose(); window.location.href = `/?category=${encodeURIComponent(tag)}`; }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="absolute right-3 bottom-36 flex flex-col items-center gap-4 z-10">
                  <button onClick={() => toggleLike(video.id)} className="flex flex-col items-center">
                    <Heart className={`h-7 w-7 ${likedVideos.has(video.id) ? 'fill-red-500 text-red-500' : 'text-white'}`} />
                    <span className="text-white text-xs mt-1">{likeCounts[video.id] || 0}</span>
                  </button>
                  <button onClick={() => toggleSave(video.id)} className="flex flex-col items-center">
                    <Bookmark className={`h-7 w-7 ${savedVideos.has(video.id) ? 'fill-yellow-500 text-yellow-500' : 'text-white'}`} />
                  </button>
                  <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center">
                    <Share2 className="h-7 w-7 text-white" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {activeVideo && (
        <ShareDrawer 
          isOpen={isShareOpen} 
          onClose={() => setIsShareOpen(false)} 
          videoId={activeVideo.id}
          videoTitle={activeVideo.title}
          username={activeVideo.profiles?.username || 'unknown'}
        />
      )}
    </div>
  );
};
