import { useEffect, useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getThumbnailUrl } from "@/lib/cloudinary";
import { getGuestClientId, getGuestLikes, setGuestLikes } from "@/lib/guestLikes";
import { prefetchHlsManifest } from "@/hooks/use-hls-player";
import { preloadImage } from "@/lib/cloudinary";
import { ModalVideoItem } from "./ModalVideoItem";

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url?: string | null;
  stream_url?: string | null;
  cloudinary_public_id?: string | null;
  cloudflare_video_id?: string | null;
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

const SCROLL_SETTLE_MS = 140;

export const VideoModal = ({ isOpen, onClose, initialVideoId, userId, videos: providedVideos, onVideoDeleted, onVideoLikeChange }: VideoModalProps) => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isScrollSettled, setIsScrollSettled] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActiveIndexRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  // Interaction state
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const [savedVideos, setSavedVideos] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [saveCounts, setSaveCounts] = useState<Record<string, number>>({});

  // Check guest likes on mount
  useEffect(() => {
    if (!userId) {
      setLikedVideos(new Set(getGuestLikes()));
    }
  }, [userId]);

  // Initialize when opened
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
        lastActiveIndexRef.current = targetIndex;
        setIsLoading(false);

        setTimeout(() => scrollToIndex(targetIndex), 50);
      } else {
        fetchVideos();
      }
      document.body.style.overflow = 'hidden';
      fetchUserInteractions();
      fetchSaveCounts();
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, initialVideoId, providedVideos]);

  // === SCROLL-SETTLE ACTIVE INDEX DETECTION (identical to main feed) ===
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || videos.length === 0 || isLoading) return;

    const getItemHeight = () => container.clientHeight || window.innerHeight || 1;

    const updateFromScrollPosition = () => {
      const itemHeight = getItemHeight();
      const rawIndex = Math.round(container.scrollTop / itemHeight);
      const nextIndex = Math.max(0, Math.min(rawIndex, videos.length - 1));
      if (nextIndex !== lastActiveIndexRef.current) {
        lastActiveIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
      }
    };

    const handleScroll = () => {
      setIsScrollSettled(false);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(updateFromScrollPosition);
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = setTimeout(() => {
        updateFromScrollPosition();
        setIsScrollSettled(true);
      }, SCROLL_SETTLE_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    updateFromScrollPosition();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [videos, isLoading]);

  // === PREFETCHING (matching main feed) ===
  useEffect(() => {
    const next1 = activeIndex + 1;
    if (next1 < videos.length) {
      eagerPrefetchVideo(videos[next1].cloudflare_video_id);
      preloadImage(getThumbnailUrl(videos[next1].cloudflare_video_id, videos[next1].thumbnail_url));
    }
    const next2 = activeIndex + 2;
    if (next2 < videos.length) {
      prefetchHlsManifest(videos[next2].cloudflare_video_id);
    }
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
        .select(`id, title, description, video_url, optimized_video_url, stream_url, cloudinary_public_id, cloudflare_video_id, thumbnail_url, views_count, likes_count, user_id, tags, profiles(username, avatar_url)`)
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

  const toggleLike = useCallback(async (videoId: string) => {
    const clientId = getGuestClientId();
    const wasLiked = likedVideos.has(videoId);

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
        body: { videoId, clientId: userId || clientId, action: wasLiked ? 'unlike' : 'like' }
      });
      if (error) throw error;
      if (data?.likesCount !== undefined) {
        setLikeCounts(prev => ({ ...prev, [videoId]: data.likesCount }));
        onVideoLikeChange?.(videoId, data.likesCount);
      }
      if (!userId) {
        const guestLikes = getGuestLikes();
        wasLiked
          ? setGuestLikes(guestLikes.filter(id => id !== videoId))
          : setGuestLikes([...guestLikes, videoId]);
      }
    } catch {
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
  }, [likedVideos, userId, onVideoLikeChange]);

  const toggleSave = useCallback(async (videoId: string) => {
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
  }, [savedVideos, userId, navigate]);

  const handleDelete = useCallback(async (videoId: string) => {
    if (!userId) return;
    try {
      await supabase.from("videos").delete().eq("id", videoId);
      toast.success("Video deleted");
      setVideos(prev => prev.filter(v => v.id !== videoId));
      onVideoDeleted?.(videoId);
      if (videos.length <= 1) onClose();
    } catch {
      toast.error("Failed to delete video");
    }
  }, [userId, videos.length, onClose, onVideoDeleted]);

  if (!isOpen) return null;

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
        style={{ overscrollBehavior: 'none', scrollSnapType: 'y mandatory' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-primary text-lg">Loading...</div>
          </div>
        ) : (
          videos.map((video, index) => {
            const isInRange = Math.abs(index - activeIndex) <= 2;
            if (!isInRange) {
              return <div key={video.id} className="w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always" />;
            }

            const distFromActive = index - activeIndex;
            const isActive = index === activeIndex;
            const shouldPreload = distFromActive === 1;
            const shouldPreloadMeta = isScrollSettled && Math.abs(distFromActive) === 2;

            return (
              <ModalVideoItem
                key={video.id}
                video={video}
                index={index}
                isActive={isActive}
                shouldPreload={shouldPreload}
                shouldPreloadMeta={shouldPreloadMeta}
                currentUserId={userId}
                isLiked={likedVideos.has(video.id)}
                isSaved={savedVideos.has(video.id)}
                likesCount={likeCounts[video.id] || 0}
                savesCount={saveCounts[video.id] || 0}
                onToggleLike={toggleLike}
                onToggleSave={toggleSave}
                onDelete={handleDelete}
                onClose={onClose}
                onVideoUpdated={(id, desc, tags) => {
                  setVideos(prev => prev.map(v => v.id === id ? { ...v, description: desc, tags } : v));
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
