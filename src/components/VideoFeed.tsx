import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage, getBestVideoSource } from "@/lib/cloudinary";

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
  const recentCreatorsRef = useRef<string[]>([]); // Track recent creators for diversity

  // Preload next video's source
  const preloadNextVideo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= videos.length) return;
    
    const nextVideo = videos[nextIndex];
    if (!nextVideo) return;
    
    // Preload thumbnail
    const thumb = getBestThumbnailUrl(nextVideo.cloudinary_public_id || null, nextVideo.thumbnail_url);
    preloadImage(thumb);
    
    // Warm video source by creating a hidden video element
    const videoSrc = getBestVideoSource(
      nextVideo.cloudinary_public_id || null,
      nextVideo.optimized_video_url || null,
      nextVideo.stream_url || null,
      nextVideo.video_url
    );
    
    // Create hidden preload video
    const preloadVideo = document.createElement('video');
    preloadVideo.preload = 'metadata';
    preloadVideo.src = videoSrc;
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

  // Fetch videos using raw fetch to bypass Supabase client issues
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchVideos = async () => {
      console.log("[VideoFeed] Starting fetch with raw fetch...");
      
      try {
        // Build the query URL
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE * 2}`;
        
        if (categoryFilter) {
          url += `&tags=cs.{${categoryFilter}}`;
        }
        if (searchQuery) {
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
        }

        console.log("[VideoFeed] Fetching from:", url);
        
        const response = await fetch(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        console.log("[VideoFeed] Response status:", response.status);

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        console.log("[VideoFeed] Got data:", data?.length);

        let results = data || [];
        
        // Client-side search filtering
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        // Filter out session duplicates
        const sessionViewed = getSessionViewedIds();
        results = results.filter((v: Video) => !sessionViewed.has(v.id));

        // Apply creator diversity - no same creator within last 3 items (but don't filter if it leaves us with no videos)
        const diverseResults: Video[] = [];
        const recentCreators: string[] = [];
        const remainingVideos: Video[] = [];
        
        for (const video of results) {
          // Skip if this creator was in last 3 videos - save for later
          if (recentCreators.slice(-3).includes(video.user_id)) {
            remainingVideos.push(video);
            continue;
          }
          diverseResults.push(video);
          recentCreators.push(video.user_id);
          loadedIdsRef.current.add(video.id);
          
          if (diverseResults.length >= PAGE_SIZE) break;
        }
        
        // If diversity filter left us with too few videos, add remaining videos
        if (diverseResults.length < PAGE_SIZE) {
          for (const video of remainingVideos) {
            if (diverseResults.length >= PAGE_SIZE) break;
            diverseResults.push(video);
            loadedIdsRef.current.add(video.id);
          }
        }

        recentCreatorsRef.current = recentCreators;
        setVideos(diverseResults);
        setHasMore(diverseResults.length >= PAGE_SIZE);
        
        // Preload second video
        if (diverseResults.length > 1) {
          const thumb = getBestThumbnailUrl(diverseResults[1].cloudinary_public_id || null, diverseResults[1].thumbnail_url);
          preloadImage(thumb);
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
  }, []);

  // Re-fetch when filters change
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    if (!searchQuery && !categoryFilter) return;
    
    const refetch = async () => {
      setLoading(true);
      setActiveIndex(0);
      loadedIdsRef.current.clear();
      recentCreatorsRef.current = [];
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      try {
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

        const data = await response.json();
        let results = data || [];
        
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) ||
            v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) ||
            v.tags?.some(t => t.toLowerCase().includes(q))
          );
        }

        // Apply creator diversity with fallback
        const diverseResults: Video[] = [];
        const recentCreators: string[] = [];
        const remainingVideos: Video[] = [];
        
        for (const video of results) {
          if (recentCreators.slice(-3).includes(video.user_id)) {
            remainingVideos.push(video);
            continue;
          }
          diverseResults.push(video);
          recentCreators.push(video.user_id);
          loadedIdsRef.current.add(video.id);
          if (diverseResults.length >= PAGE_SIZE) break;
        }
        
        // Add remaining if needed
        if (diverseResults.length < PAGE_SIZE) {
          for (const video of remainingVideos) {
            if (diverseResults.length >= PAGE_SIZE) break;
            diverseResults.push(video);
            loadedIdsRef.current.add(video.id);
          }
        }

        recentCreatorsRef.current = recentCreators;
        setVideos(diverseResults);
        setHasMore(diverseResults.length >= PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load videos");
      } finally {
        setLoading(false);
      }
    };

    refetch();
  }, [searchQuery, categoryFilter]);

  // Scroll handling with lower threshold (0.4 instead of 1.0)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number;
    
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const scrollTop = container.scrollTop;
        const itemHeight = container.clientHeight;
        // Lower threshold: activate when 40% visible (not 100%)
        const newIndex = Math.round(scrollTop / itemHeight);
        
        if (newIndex >= 0 && newIndex < videos.length && newIndex !== activeIndex) {
          setActiveIndex(newIndex);
          
          // Preload next video
          preloadNextVideo(newIndex + 1);
          
          // Track session view
          if (videos[newIndex]) {
            addSessionViewedId(videos[newIndex].id);
          }
        }
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [activeIndex, videos.length, videos, preloadNextVideo]);

  // Load more
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || videos.length === 0) return;
    if (activeIndex < videos.length - 3) return;

    const loadMore = async () => {
      setIsLoadingMore(true);
      try {
        const offset = videos.length;
        
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE * 2}`;
        
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
        const sessionViewed = getSessionViewedIds();
        
        // Filter and apply diversity with fallback
        const newVideos: Video[] = [];
        const skippedVideos: Video[] = [];
        
        for (const video of (data || [])) {
          if (loadedIdsRef.current.has(video.id)) continue;
          if (sessionViewed.has(video.id)) continue;
          
          if (recentCreatorsRef.current.slice(-3).includes(video.user_id)) {
            skippedVideos.push(video);
            continue;
          }
          
          newVideos.push(video);
          loadedIdsRef.current.add(video.id);
          recentCreatorsRef.current.push(video.user_id);
          
          if (newVideos.length >= PAGE_SIZE) break;
        }
        
        // Add skipped videos if needed
        if (newVideos.length < PAGE_SIZE) {
          for (const video of skippedVideos) {
            if (newVideos.length >= PAGE_SIZE) break;
            newVideos.push(video);
            loadedIdsRef.current.add(video.id);
          }
        }
        
        setVideos(prev => [...prev, ...newVideos]);
        setHasMore(newVideos.length > 0);
      } catch (err) {
        console.error("Load more error:", err);
      } finally {
        setIsLoadingMore(false);
      }
    };

    loadMore();
  }, [activeIndex, videos.length, hasMore, isLoadingMore, loading, searchQuery, categoryFilter]);

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

  // Debug scroll state on every render
  useEffect(() => {
    if (!DEBUG_SCROLL || !containerRef.current) return;
    
    const container = containerRef.current;
    
    const debugWheel = (e: WheelEvent) => {
      console.log('[Scroll Debug] wheel event:', {
        deltaY: e.deltaY,
        defaultPrevented: e.defaultPrevented,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        elementAtCenter: document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.tagName,
      });
    };
    
    container.addEventListener('wheel', debugWheel, { passive: true });
    return () => container.removeEventListener('wheel', debugWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-[100dvh] overflow-y-auto bg-black snap-y snap-mandatory"
      style={{ 
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {videos.map((video, index) => (
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
      ))}
      {isLoadingMore && (
        <div className="flex justify-center py-4 bg-black h-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};