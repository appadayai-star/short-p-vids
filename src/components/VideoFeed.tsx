import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage, getBestVideoSource, warmupVideoUrl } from "@/lib/cloudinary";

const PAGE_SIZE = 10;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const DEBUG_SCROLL = import.meta.env.DEV;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

interface VideoFeedProps {
  searchQuery: string;
  categoryFilter: string;
  userId: string | null;
}

// Get session-viewed videos to prevent duplicates within session
const getSessionViewedIds = (): Set<string> => {
  try {
    const viewed = sessionStorage.getItem('session_viewed_videos');
    return new Set(viewed ? JSON.parse(viewed) : []);
  } catch {
    return new Set();
  }
};

const addSessionViewedId = (videoId: string) => {
  try {
    const viewed = getSessionViewedIds();
    viewed.add(videoId);
    // Keep only last 100 to prevent storage bloat
    const arr = Array.from(viewed).slice(-100);
    sessionStorage.setItem('session_viewed_videos', JSON.stringify(arr));
  } catch {}
};

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const hasFetchedRef = useRef(false);
  const pageRef = useRef(0);

  // Preload next video's source
  const preloadNextVideo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= videos.length) return;
    
    const nextVideo = videos[nextIndex];
    if (!nextVideo) return;
    
    // Preload thumbnail
    const thumb = getBestThumbnailUrl(nextVideo.cloudinary_public_id || null, nextVideo.thumbnail_url);
    preloadImage(thumb);
    
    // Warm video source by creating a hidden video element
    const videoSource = getBestVideoSource(
      nextVideo.cloudinary_public_id || null,
      nextVideo.optimized_video_url || null,
      nextVideo.stream_url || null,
      nextVideo.video_url
    );
    
    // Create hidden preload video
    const preloadVideo = document.createElement('video');
    preloadVideo.preload = 'metadata';
    preloadVideo.src = videoSource.url;
    preloadVideo.muted = true;
    preloadVideo.load();
    
    // Clean up after metadata loaded or timeout
    const cleanup = () => {
      preloadVideo.src = '';
      preloadVideo.load();
    };
    preloadVideo.onloadedmetadata = cleanup;
    setTimeout(cleanup, 5000);
  }, [videos]);

  // Fetch videos using the recommendation edge function
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchVideos = async () => {
      console.log("[VideoFeed] Starting fetch...");
      
      try {
        // For search/category, use direct query; for main feed, use recommendation algorithm
        if (searchQuery || categoryFilter) {
          // Direct query for filtered views
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE * 2}`;
          
          if (categoryFilter) {
            url += `&tags=cs.{${categoryFilter}}`;
          }
          if (searchQuery) {
            url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
          }

          const response = await fetch(url, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

          let results = await response.json() || [];
          
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            results = results.filter((v: Video) =>
              v.title?.toLowerCase().includes(q) ||
              v.description?.toLowerCase().includes(q) ||
              v.profiles?.username?.toLowerCase().includes(q) ||
              v.tags?.some(t => t.toLowerCase().includes(q))
            );
          }

          results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(results.slice(0, PAGE_SIZE));
          setHasMore(results.length >= PAGE_SIZE);
        } else {
          // Use recommendation edge function for main feed
          const sessionViewedIds = Array.from(getSessionViewedIds());
          const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId, page: 0, limit: PAGE_SIZE, sessionViewedIds }
          });

          if (error) throw error;

          const resultVideos = data?.videos || [];
          console.log("[VideoFeed] Got recommended videos:", resultVideos.length);
          
          resultVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(resultVideos);
          setHasMore(resultVideos.length >= PAGE_SIZE);
          
          // Preload second video thumbnail
          if (resultVideos.length > 1) {
            const thumb = getBestThumbnailUrl(resultVideos[1].cloudinary_public_id || null, resultVideos[1].thumbnail_url);
            preloadImage(thumb);
          }
        }
      } catch (err) {
        console.error("[VideoFeed] Fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load videos");
        setVideos([]);
      } finally {
        setLoading(false);
        console.log("[VideoFeed] Fetch complete");
      }
    };

    fetchVideos();
  }, [userId]);

  // Re-fetch when filters change
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    if (!searchQuery && !categoryFilter) return;
    
    const refetch = async () => {
      setLoading(true);
      setActiveIndex(0);
      loadedIdsRef.current.clear();
      pageRef.current = 0;
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      try {
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
        
        if (categoryFilter) url += `&tags=cs.{${categoryFilter}}`;
        if (searchQuery) url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;

        const response = await fetch(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

        let results = await response.json() || [];
        
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
        setVideos(results);
        setHasMore(results.length >= PAGE_SIZE);
        
        // Warmup first video URL with HEAD request for faster initial load
        if (results.length > 0) {
          const firstVideoSource = getBestVideoSource(
            results[0].cloudinary_public_id || null,
            results[0].optimized_video_url || null,
            results[0].stream_url || null,
            results[0].video_url
          );
          warmupVideoUrl(firstVideoSource.url);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load videos");
      } finally {
        setLoading(false);
      }
    };

    refetch();
  }, [searchQuery, categoryFilter]);

  // Intersection observer for active detection - 40% threshold for earlier activation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;

    const observers: IntersectionObserver[] = [];
    
    const items = container.querySelectorAll('[data-video-index]');
    items.forEach((item) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
              const idx = parseInt((entry.target as HTMLElement).dataset.videoIndex || '0', 10);
              if (idx !== activeIndex) {
                setActiveIndex(idx);
                
                // Track session view
                if (videos[idx]) {
                  addSessionViewedId(videos[idx].id);
                }
                
                // Preload next video immediately
                preloadNextVideo(idx + 1);
              }
            }
          });
        },
        { threshold: [0.4, 0.6, 0.8], root: container }
      );
      observer.observe(item);
      observers.push(observer);
    });

    return () => {
      observers.forEach(obs => obs.disconnect());
    };
  }, [videos, activeIndex, preloadNextVideo]);

  // Load more - trigger earlier (within last 2 items instead of 3)
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || videos.length === 0) return;
    if (activeIndex < videos.length - 2) return; // Changed from -3 to -2 for earlier trigger
    
    if (DEBUG_SCROLL) {
      console.log('[Pagination] Triggering load more:', { activeIndex, videosLength: videos.length, hasMore });
    }

    const loadMore = async () => {
      setIsLoadingMore(true);
      pageRef.current += 1;
      
      try {
        if (searchQuery || categoryFilter) {
          // Direct query for filtered views
          const offset = videos.length;
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE}`;
          
          if (categoryFilter) url += `&tags=cs.{${categoryFilter}}`;
          if (searchQuery) url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;

          const response = await fetch(url, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

          const data = await response.json();
          const newVideos = (data || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        } else {
          // Use edge function for paginated feed
          const sessionViewedIds = Array.from(getSessionViewedIds());
          const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId, page: pageRef.current, limit: PAGE_SIZE, sessionViewedIds }
          });

          if (error) throw error;

          const newVideos = (data?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        }
      } catch (err) {
        console.error("Load more error:", err);
      } finally {
        setIsLoadingMore(false);
      }
    };

    loadMore();
  }, [activeIndex, videos.length, hasMore, isLoadingMore, loading, searchQuery, categoryFilter, userId]);

  const handleViewTracked = useCallback(async (videoId: string) => {
    addSessionViewedId(videoId);
    try {
      await supabase.from("video_views").insert({ video_id: videoId, user_id: userId });
    } catch {}
  }, [userId]);

  const handleRetry = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-4">
        <p className="text-red-400 text-lg text-center">{error}</p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg"
        >
          <RefreshCw className="h-5 w-5" /> Try Again
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-black">
        <p className="text-primary text-lg">
          {searchQuery ? "No videos found" : categoryFilter ? `No videos in ${categoryFilter}` : "No videos yet"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[100dvh] overflow-y-auto overflow-x-hidden scrollbar-hide bg-black snap-y snap-mandatory"
      style={{ 
        overscrollBehavior: 'none',
        scrollSnapType: 'y mandatory',
      }}
    >
      {videos.map((video, index) => {
        // Virtualization: only render videos within range
        const isInRange = Math.abs(index - activeIndex) <= 3;
        if (!isInRange) {
          // Placeholder for virtualized items
          return (
            <div
              key={video.id}
              data-video-index={index}
              className="w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always"
            />
          );
        }
        
        return (
          <FeedItem
            key={video.id}
            video={video}
            index={index}
            isActive={index === activeIndex}
            shouldPreload={Math.abs(index - activeIndex) <= 1}
            hasEntered={hasEntered}
            currentUserId={userId}
            onViewTracked={handleViewTracked}
          />
        );
      })}
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black h-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};