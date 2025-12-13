import { useState, useRef, useEffect, memo, useCallback } from "react";
import { Heart, Share2, Bookmark, MoreVertical, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ShareDrawer } from "./ShareDrawer";
import { getBestThumbnailUrl } from "@/lib/cloudinary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  tags: string[] | null;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface FeedItemProps {
  video: Video;
  index: number;
  isActive: boolean;
  currentUserId: string | null;
  onDelete?: (videoId: string) => void;
  onContainerRef: (index: number, ref: HTMLDivElement | null) => void;
}

export const FeedItem = memo(({ 
  video, 
  index,
  isActive,
  currentUserId, 
  onDelete,
  onContainerRef
}: FeedItemProps) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  
  const posterSrc = getBestThumbnailUrl(video.cloudinary_public_id || null, video.thumbnail_url);
  
  // UI state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [isSaved, setIsSaved] = useState(false);
  const [savesCount, setSavesCount] = useState(0);
  const [isShareOpen, setIsShareOpen] = useState(false);

  // Register container ref with parent
  useEffect(() => {
    onContainerRef(index, containerRef.current);
    return () => onContainerRef(index, null);
  }, [index, onContainerRef]);

  // Check if guest has liked this video
  useEffect(() => {
    if (!currentUserId) {
      const guestLikes = getGuestLikes();
      setIsLiked(guestLikes.includes(video.id));
    }
  }, [video.id, currentUserId]);

  // Fetch interaction states for logged-in users
  useEffect(() => {
    if (!currentUserId) return;

    const fetchStates = async () => {
      const [likeResult, saveResult, savesCountResult] = await Promise.all([
        supabase.from("likes").select("id").eq("video_id", video.id).eq("user_id", currentUserId).maybeSingle(),
        supabase.from("saved_videos").select("id").eq("video_id", video.id).eq("user_id", currentUserId).maybeSingle(),
        supabase.from("saved_videos").select("*", { count: "exact", head: true }).eq("video_id", video.id)
      ]);

      setIsLiked(!!likeResult.data);
      setIsSaved(!!saveResult.data);
      setSavesCount(savesCountResult.count || 0);
    };

    fetchStates();
  }, [video.id, currentUserId]);

  const toggleLike = async () => {
    const clientId = getGuestClientId();
    const wasLiked = isLiked;
    
    setIsLiked(!wasLiked);
    setLikesCount(prev => wasLiked ? prev - 1 : prev + 1);

    try {
      const { data, error } = await supabase.functions.invoke('like-video', {
        body: {
          videoId: video.id,
          clientId: currentUserId || clientId,
          action: wasLiked ? 'unlike' : 'like'
        }
      });

      if (error) throw error;

      if (data?.likesCount !== undefined) {
        setLikesCount(data.likesCount);
      }

      if (!currentUserId) {
        const guestLikes = getGuestLikes();
        if (wasLiked) {
          setGuestLikes(guestLikes.filter(id => id !== video.id));
        } else {
          setGuestLikes([...guestLikes, video.id]);
        }
      }
    } catch (error) {
      setIsLiked(wasLiked);
      setLikesCount(prev => wasLiked ? prev + 1 : prev - 1);
      toast.error("Failed to update like");
    }
  };

  const toggleSave = async () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }

    try {
      if (isSaved) {
        await supabase.from("saved_videos").delete().eq("video_id", video.id).eq("user_id", currentUserId);
        setIsSaved(false);
        setSavesCount(prev => prev - 1);
        toast.success("Removed from saved");
      } else {
        await supabase.from("saved_videos").insert({ video_id: video.id, user_id: currentUserId });
        setIsSaved(true);
        setSavesCount(prev => prev + 1);
        toast.success("Saved");
      }
    } catch (error) {
      toast.error("Failed to save video");
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || video.user_id !== currentUserId) return;

    try {
      await supabase.from("videos").delete().eq("id", video.id);
      toast.success("Video deleted");
      onDelete?.(video.id);
    } catch (error) {
      toast.error("Failed to delete video");
    }
  };

  const handleCategoryClick = (tag: string) => {
    window.location.href = `/?category=${encodeURIComponent(tag)}`;
  };

  const handleProfileClick = () => {
    navigate(`/profile/${video.user_id}`);
  };

  const isOwnVideo = currentUserId === video.user_id;

  return (
    <div 
      ref={containerRef}
      className="relative w-full bg-black flex items-center justify-center flex-shrink-0"
      style={{
        height: '100dvh',
        scrollSnapAlign: 'start',
        scrollSnapStop: 'always'
      }}
    >
      {/* Thumbnail background - always visible, fallback gradient if no poster */}
      {posterSrc ? (
        <img 
          src={posterSrc} 
          alt="" 
          className={cn(
            "absolute inset-0 w-full h-full object-cover md:object-contain",
            isActive ? "opacity-0" : "opacity-100"
          )}
          loading={index === 0 ? "eager" : "lazy"}
        />
      ) : (
        <div className={cn(
          "absolute inset-0 w-full h-full bg-gradient-to-b from-gray-900 to-black flex items-center justify-center",
          isActive ? "opacity-0" : "opacity-100"
        )}>
          <div className="text-muted-foreground text-xs">Loading...</div>
        </div>
      )}

      {/* Right side actions */}
      <div className="absolute right-4 bottom-[180px] flex flex-col gap-6 z-40">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Heart className={cn("h-7 w-7", isLiked ? "fill-primary text-primary" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{likesCount}</span>
        </button>

        <button onClick={toggleSave} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Bookmark className={cn("h-7 w-7", isSaved ? "fill-yellow-500 text-yellow-500" : "text-white")} />
          </div>
          <span className="text-white text-xs font-semibold">{savesCount}</span>
        </button>

        <button onClick={() => setIsShareOpen(true)} className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
            <Share2 className="h-7 w-7 text-white" />
          </div>
        </button>

        {isOwnVideo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:scale-110 transition-transform">
                  <MoreVertical className="h-7 w-7 text-white" />
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background border-border z-50">
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive cursor-pointer">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[100px] z-40 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none pr-[80px]">
        <div className="space-y-2 pointer-events-auto">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit" onClick={handleProfileClick}>
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border-2 border-primary">
              {video.profiles.avatar_url ? (
                <img src={video.profiles.avatar_url} alt={video.profiles.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                  {video.profiles.username[0].toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-white font-semibold">@{video.profiles.username}</span>
          </div>

          {video.description && <p className="text-white/90 text-sm">{video.description}</p>}

          {video.tags && video.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {video.tags.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); handleCategoryClick(tag); }}
                  className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShareDrawer videoTitle={video.title} username={video.profiles.username} isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} />
    </div>
  );
});

FeedItem.displayName = 'FeedItem';
