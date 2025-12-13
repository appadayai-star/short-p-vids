import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { useEntryGate } from "./EntryGate";
import { getBestThumbnailUrl, preloadImage, getBestVideoSource } from "@/lib/cloudinary";
import { log, newRequestId } from "@/lib/feedLogger";
import { fetchWithTimeout, invokeWithTimeout } from "@/lib/fetchWithTimeout";

const PAGE_SIZE = 10;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const WATCHDOG_TIMEOUT = 10000; // 10s max loading time

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
    const arr = Array.from(viewed).slice(-100);
    sessionStorage.setItem('session_viewed_videos', JSON.stringify(arr));
  } catch {}
};

// Warm first video with HEAD request (lightweight, just primes connection)
const warmFirstVideo = (video: Video) => {
  const src = getBestVideoSource(
    video.cloudinary_public_id || null,
    video.optimized_video_url || null,
    video.stream_url || null,
    video.video_url
  );
  
  // Fire and forget HEAD request to prime DNS/TLS/connection
  fetch(src, {
    method: 'HEAD',
    mode: 'cors',
    credentials: 'omit',
  }).catch(() => {});
  
  log.info('FIRST_VIDEO_WARM', { 
    videoId: video.id, 
    hasCloudinary: !!video.cloudinary_public_id,
    source: video.cloudinary_public_id ? 'cloudinary' : 'supabase'
  });
};

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [watchdogTriggered, setWatchdogTriggered] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const hasFetchedRef = useRef(false);
  const pageRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);

  // Clear watchdog
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Start watchdog - auto-show error if loading takes too long
  const startWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      if (loading) {
        log.error('WATCHDOG_TIMEOUT', { timeout: WATCHDOG_TIMEOUT });
        setWatchdogTriggered(true);
        setLoading(false);
        setError('Loading took too long. Please try again.');
      }
    }, WATCHDOG_TIMEOUT);
  }, [loading, clearWatchdog]);

  // Fallback: simple direct query if edge function fails
  const fallbackFetch = async (): Promise<Video[]> => {
    log.info('FALLBACK_FETCH_START');
    const url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
    
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // Shorter timeout for fallback
        retries: 1,
      });
      
      const data = await response.json();
      log.info('FALLBACK_FETCH_OK', { count: data?.length });
      return data || [];
    } catch (err) {
      log.error('FALLBACK_FETCH_FAIL', { error: err instanceof Error ? err.message : 'Unknown' });
      return [];
    }
  };

  // Preload next video - lightweight warmup
  const preloadNextVideo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= videos.length) return;
    
    const nextVideo = videos[nextIndex];
    if (!nextVideo) return;
    
    const thumb = getBestThumbnailUrl(nextVideo.cloudinary_public_id || null, nextVideo.thumbnail_url);
    preloadImage(thumb);
    
    // Use HEAD request for next video (lightweight warmup, no download)
    const src = getBestVideoSource(
      nextVideo.cloudinary_public_id || null,
      nextVideo.optimized_video_url || null,
      nextVideo.stream_url || null,
      nextVideo.video_url
    );
    
    fetch(src, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
    }).catch(() => {});
  }, [videos]);

  // Main fetch effect
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    
    newRequestId();
    log.info('FEED_FETCH_START', { userId: userId || 'anon', hasFilters: !!(searchQuery || categoryFilter) });
    startWatchdog();

    const fetchVideos = async () => {
      try {
        let resultVideos: Video[] = [];
        
        if (searchQuery || categoryFilter) {
          // Direct query for filtered views
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE * 2}`;
          
          if (categoryFilter) {
            url += `&tags=cs.{${categoryFilter}}`;
          }
          if (searchQuery) {
            url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
          }

          const response = await fetchWithTimeout(url, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
          });

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

          resultVideos = results.slice(0, PAGE_SIZE);
        } else {
          // Try edge function first, fallback to direct query
          const sessionViewedIds = Array.from(getSessionViewedIds());
          const { data, error: invokeError } = await invokeWithTimeout<{ videos: Video[] }>(
            supabase,
            'get-for-you-feed',
            { userId, page: 0, limit: PAGE_SIZE, sessionViewedIds },
            8000
          );

          if (invokeError || !data?.videos?.length) {
            log.warn('EDGE_FUNCTION_FAILED_FALLBACK', { error: invokeError?.message });
            resultVideos = await fallbackFetch();
          } else {
            resultVideos = data.videos;
          }
        }
        
        log.info('FEED_FETCH_OK', { count: resultVideos.length });
        
        resultVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
        setVideos(resultVideos);
        setHasMore(resultVideos.length >= PAGE_SIZE);
        
        // Warm first video
        if (resultVideos.length > 0) {
          warmFirstVideo(resultVideos[0]);
          log.info('FIRST_VIDEO_SRC_SET', { videoId: resultVideos[0].id });
        }
        
        // Preload second video thumbnail
        if (resultVideos.length > 1) {
          const thumb = getBestThumbnailUrl(resultVideos[1].cloudinary_public_id || null, resultVideos[1].thumbnail_url);
          preloadImage(thumb);
        }
        
        setError(null);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to load videos";
        log.error('FEED_FETCH_FAIL', { error: errorMsg });
        
        // Try fallback as last resort
        try {
          const fallbackVideos = await fallbackFetch();
          if (fallbackVideos.length > 0) {
            setVideos(fallbackVideos);
            setHasMore(fallbackVideos.length >= PAGE_SIZE);
            fallbackVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
            if (fallbackVideos.length > 0) warmFirstVideo(fallbackVideos[0]);
            setError(null);
            return;
          }
        } catch {}
        
        setError(errorMsg);
        setVideos([]);
      } finally {
        clearWatchdog();
        setLoading(false);
        log.info('FEED_FETCH_COMPLETE');
      }
    };

    fetchVideos();
    
    return () => clearWatchdog();
  }, [userId, startWatchdog, clearWatchdog, searchQuery, categoryFilter]);

  // Re-fetch when filters change
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    if (!searchQuery && !categoryFilter) return;
    
    const refetch = async () => {
      setLoading(true);
      setActiveIndex(0);
      loadedIdsRef.current.clear();
      pageRef.current = 0;
      startWatchdog();
      
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      try {
        let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
        
        if (categoryFilter) url += `&tags=cs.{${categoryFilter}}`;
        if (searchQuery) url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;

        const response = await fetchWithTimeout(url, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

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
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load videos");
      } finally {
        clearWatchdog();
        setLoading(false);
      }
    };

    refetch();
  }, [searchQuery, categoryFilter, startWatchdog, clearWatchdog]);

  // Intersection observer for active detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;

    const observers: IntersectionObserver[] = [];
    
    const items = container.querySelectorAll('[data-video-index]');
    items.forEach((item) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            // Trigger at 30% visibility for faster playback start
            if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
              const idx = parseInt((entry.target as HTMLElement).dataset.videoIndex || '0', 10);
              if (idx !== activeIndex) {
                setActiveIndex(idx);
                
                if (videos[idx]) {
                  addSessionViewedId(videos[idx].id);
                }
                
                // Preload next video
                preloadNextVideo(idx + 1);
              }
            }
          });
        },
        { threshold: [0.3, 0.5, 0.7], root: container }
      );
      observer.observe(item);
      observers.push(observer);
    });

    return () => {
      observers.forEach(obs => obs.disconnect());
    };
  }, [videos, activeIndex, preloadNextVideo]);

  // Load more videos
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || videos.length === 0) return;
    if (activeIndex < videos.length - 2) return;

    const loadMore = async () => {
      setIsLoadingMore(true);
      pageRef.current += 1;
      
      try {
        if (searchQuery || categoryFilter) {
          const offset = videos.length;
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE}`;
          
          if (categoryFilter) url += `&tags=cs.{${categoryFilter}}`;
          if (searchQuery) url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;

          const response = await fetchWithTimeout(url, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
            retries: 1,
          });

          const data = await response.json();
          const newVideos = (data || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        } else {
          const sessionViewedIds = Array.from(getSessionViewedIds());
          const { data, error: invokeError } = await invokeWithTimeout<{ videos: Video[] }>(
            supabase,
            'get-for-you-feed',
            { userId, page: pageRef.current, limit: PAGE_SIZE, sessionViewedIds },
            5000
          );

          if (invokeError) throw invokeError;

          const newVideos = (data?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        }
      } catch (err) {
        log.warn('LOAD_MORE_ERROR', { error: err instanceof Error ? err.message : 'Unknown' });
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

  const handleRetry = useCallback(() => {
    log.info('USER_RETRY');
    setError(null);
    setWatchdogTriggered(false);
    setLoading(true);
    hasFetchedRef.current = false;
    loadedIdsRef.current.clear();
    pageRef.current = 0;
    
    // Force re-mount by changing key won't work here, so trigger fetch manually
    window.location.reload();
  }, []);

  // Loading state with watchdog info
  if (loading && !watchdogTriggered) {
    return (
      <div className="flex flex-col justify-center items-center h-[100dvh] bg-black gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Loading videos...</p>
      </div>
    );
  }

  // Error or watchdog triggered
  if (error || watchdogTriggered) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-black gap-4 px-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-red-400 text-lg text-center">{error || 'Something went wrong'}</p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
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
        const isInRange = Math.abs(index - activeIndex) <= 3;
        if (!isInRange) {
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
