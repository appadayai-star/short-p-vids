import { useEffect, useState, useRef, useCallback } from "react";
import { X, Heart, Share2, Bookmark, Volume2, VolumeX, MoreVertical, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getBestVideoSource, getBestThumbnailUrl } from "@/lib/cloudinary";
import { ShareDrawer } from "./ShareDrawer";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Global mute state
let globalMuted = true;
const muteListeners = new Set<(muted: boolean) => void>();
const setGlobalMuted = (muted: boolean) => {
  globalMuted = muted;
  muteListeners.forEach(listener => listener(muted));
};

// Guest client ID for anonymous likes
const getGuestClientId = (): string => {
  const key = 'guest_client_id';
  let clientId = localStorage.getItem(key);
  if (!clientId) {
    clientId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(key, clientId);
  }
  return clientId;
};

// Guest likes storage
const getGuestLikes = (): string[] => {
  try {
    const likes = localStorage.getItem('guest_likes_v1');
    return likes ? JSON.parse(likes) : [];
  } catch {
    return [];
  }
};

const setGuestLikes = (likes: string[]) => {
  localStorage.setItem('guest_likes_v1', JSON.stringify(likes));
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
  onVideoDeleted?: (videoId: string) => void;
  onVideoLikeChange?: (videoId: string, newLikesCount: number) => void;
}

export const VideoModal = ({ isOpen, onClose, initialVideoId, userId, videos: providedVideos, onVideoDeleted, onVideoLikeChange }: VideoModalProps) => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(globalMuted);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const [savedVideos, setSavedVideos] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const isScrollingRef = useRef(false);

  // Sync with global mute
  useEffect(() => {
    const listener = (muted: boolean) => setIsMuted(muted);
    muteListeners.add(listener);
    return () => { muteListeners.delete(listener); };
  }, []);

  // Check guest likes on mount
  useEffect(() => {
    if (!userId) {
      const guestLikes = getGuestLikes();
      setLikedVideos(new Set(guestLikes));
    }
  }, [userId]);

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
      fetchSaveCounts();
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

  const fetchSaveCounts = async () => {
    const videoIds = providedVideos?.map(v => v.id) || [];
    if (videoIds.length === 0) return;
    
    try {
      const counts: Record<string, number> = {};
      for (const id of videoIds) {
        const { count } = await supabase
          .from("saved_videos")
          .select("*", { count: "exact", head: true })
          .eq("video_id", id);
        counts[id] = count || 0;
      }
      setSaveCounts(counts);
    } catch (error) {
      console.error("Error fetching save counts:", error);
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

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setGlobalMuted(newMuted);
    setShowMuteIcon(true);
    setTimeout(() => setShowMuteIcon(false), 500);
  }, [isMuted]);

  const toggleLike = async (videoId: string) => {
    const clientId = getGuestClientId();
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
      const { data, error } = await supabase.functions.invoke('like-video', {
        body: { 
          videoId, 
          clientId: userId || clientId, 
          action: wasLiked ? 'unlike' : 'like' 
        }
      });

      if (error) throw error;

      // Update with server count if returned
      if (data?.likesCount !== undefined) {
        setLikeCounts(prev => ({
          ...prev,
          [videoId]: data.likesCount
        }));
        // Notify parent about the like change so it can update its state
        onVideoLikeChange?.(videoId, data.likesCount);
      }

      // Update guest likes storage
      if (!userId) {
        const guestLikes = getGuestLikes();
        if (wasLiked) {
          setGuestLikes(guestLikes.filter(id => id !== videoId));
        } else {
          setGuestLikes([...guestLikes, videoId]);
        }
      }
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
    setSaveCounts(prev => ({
      ...prev,
      [videoId]: (prev[videoId] || 0) + (wasSaved ? -1 : 1)
    }));

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
      setSaveCounts(prev => ({
        ...prev,
        [videoId]: (prev[videoId] || 0) + (wasSaved ? 1 : -1)
      }));
      toast.error("Failed to save video");
    }
  };

  const handleDelete = async (videoId: string) => {
    if (!userId) return;
    
    try {
      await supabase.from("videos").delete().eq("id", videoId);
      toast.success("Video deleted");
      setVideos(prev => prev.filter(v => v.id !== videoId));
      onVideoDeleted?.(videoId);
      
      if (videos.length <= 1) {
        onClose();
      }
    } catch {
      toast.error("Failed to delete video");
    }
  };

  if (!isOpen) return null;

  const activeVideo = videos[activeIndex];
  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

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
            const isOwnVideo = userId === video.user_id;

            return (
              <div key={video.id} className="relative w-full h-[100dvh] snap-start snap-always bg-black flex items-center justify-center">
                {/* Poster/Thumbnail */}
                {posterSrc && (
                  <img 
                    src={posterSrc} 
                    alt="" 
                    className="absolute inset-0 w-full h-full object-cover md:object-contain"
                    style={{ paddingBottom: navOffset, opacity: isActive ? 0 : 1 }}
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
                    className="absolute inset-0 w-full h-full object-cover md:object-contain"
                    style={{ paddingBottom: navOffset }}
                    loop
                    muted={isMuted}
                    playsInline
                    preload={isActive ? "auto" : "metadata"}
                    onClick={toggleMute}
                  />
                )}

                {/* Mute indicator flash */}
                {showMuteIcon && isActive && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                    <div className="bg-black/50 rounded-full p-4 animate-scale-in">
                      {isMuted ? <VolumeX className="h-12 w-12 text-white" /> : <Volume2 className="h-12 w-12 text-white" />}
                    </div>
                  </div>
                )}

                {/* Right side actions - matching FeedItem layout */}
                <div 
                  className="absolute right-4 flex flex-col items-center gap-5 z-40"
                  style={{ bottom: navOffset, paddingBottom: '140px' }}
                >
                  <button onClick={() => toggleLike(video.id)} className="flex flex-col items-center gap-1">
                    <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
                      <Heart className={cn("h-6 w-6", likedVideos.has(video.id) ? "fill-primary text-primary" : "text-white")} />
                    </div>
                    <span className="text-white text-xs font-semibold drop-shadow">{likeCounts[video.id] || 0}</span>
                  </button>

                  <button onClick={() => toggleSave(video.id)} className="flex flex-col items-center gap-1">
                    <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
                      <Bookmark className={cn("h-6 w-6", savedVideos.has(video.id) ? "fill-yellow-500 text-yellow-500" : "text-white")} />
                    </div>
                    <span className="text-white text-xs font-semibold drop-shadow">{saveCounts[video.id] || 0}</span>
                  </button>

                  <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center">
                    <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
                      <Share2 className="h-6 w-6 text-white" />
                    </div>
                  </button>

                  <button onClick={toggleMute} className="flex flex-col items-center">
                    <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
                      {isMuted ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-white" />}
                    </div>
                  </button>

                  {isOwnVideo && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex flex-col items-center">
                          <div className="w-11 h-11 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:scale-110 transition-transform">
                            <MoreVertical className="h-6 w-6 text-white" />
                          </div>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-background border-border z-50">
                        <DropdownMenuItem onClick={() => handleDelete(video.id)} className="text-destructive focus:text-destructive cursor-pointer">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Bottom info - matching FeedItem layout */}
                <div 
                  className="absolute left-0 right-0 p-4 z-40 bg-gradient-to-t from-black via-black/60 to-transparent pr-[80px]"
                  style={{ bottom: navOffset }}
                >
                  <div className="space-y-2">
                    <div 
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit"
                      onClick={() => { onClose(); navigate(`/profile/${video.user_id}`); }}
                    >
                      <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border-2 border-primary">
                        {video.profiles?.avatar_url ? (
                          <img src={video.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                            {video.profiles?.username?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                      </div>
                      <span className="text-white font-semibold">@{video.profiles?.username}</span>
                    </div>
                    
                    {video.description && <p className="text-white/90 text-sm">{video.description}</p>}
                    
                    {video.tags && video.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {video.tags.map((tag, i) => (
                          <button
                            key={i}
                            onClick={() => { onClose(); window.location.href = `/?category=${encodeURIComponent(tag)}`; }}
                            className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
