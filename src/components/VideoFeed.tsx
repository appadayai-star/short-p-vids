import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedItem } from "./FeedItem";
import { LivestreamAdItem } from "./LivestreamAdItem";
import { Loader2, RefreshCw } from "lucide-react";
import { useEntryGate } from "./EntryGate";

import { createAdPicker, type Ad } from "@/lib/adRotation";
import { prefetchHlsManifest } from "@/hooks/use-hls-player";

const PAGE_SIZE = 10;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const DEBUG_SCROLL = import.meta.env.DEV;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Keep this short so the landed-on video becomes priority almost immediately
const SCROLL_SETTLE_MS = 140;

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
  tags: string[] | null;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

// Ad type imported from adRotation

type FeedEntry = 
  | { type: 'video'; data: Video }
  | { type: 'ad'; data: Ad };

interface VideoFeedProps {
  searchQuery: string;
  categoryFilter: string;
  userId: string | null;
}

interface FeedCursor {
  score: number;
  id: string;
}

const getOrCreateViewerId = (): string => {
  const key = 'anonymous_viewer_id_v1';
  let viewerId = localStorage.getItem(key);
  if (!viewerId) {
    viewerId = crypto.randomUUID ? crypto.randomUUID() : 
      `anon_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(key, viewerId);
  }
  return viewerId;
};

const getOrCreateSessionId = (): string => {
  const key = 'video_session_v2';
  const lastActivityKey = 'video_session_last_activity';
  const SESSION_EXPIRY_MS = 30 * 60 * 1000;
  const now = Date.now();
  const lastActivity = parseInt(localStorage.getItem(lastActivityKey) || '0', 10);
  let sessionId = localStorage.getItem(key);
  if (!sessionId || (now - lastActivity) > SESSION_EXPIRY_MS) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : 
      `sess_${now}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(key, sessionId);
    sessionStorage.removeItem('session_viewed_videos');
  }
  localStorage.setItem(lastActivityKey, now.toString());
  return sessionId;
};

const getSessionViewedIds = (): string[] => {
  try {
    const viewed = sessionStorage.getItem('session_viewed_videos');
    return viewed ? JSON.parse(viewed) : [];
  } catch { return []; }
};

const addSessionViewedId = (videoId: string) => {
  try {
    const viewed = new Set(getSessionViewedIds());
    viewed.add(videoId);
    sessionStorage.setItem('session_viewed_videos', JSON.stringify(Array.from(viewed).slice(-100)));
  } catch {}
};

interface SessionWatchEntry {
  videoId: string;
  watchDuration: number;
  tags: string[];
}

const getSessionWatchData = (): SessionWatchEntry[] => {
  try {
    const data = sessionStorage.getItem('session_watch_data');
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

const addSessionWatchData = (entry: SessionWatchEntry) => {
  try {
    const data = getSessionWatchData();
    const existing = data.findIndex(e => e.videoId === entry.videoId);
    if (existing >= 0) data[existing] = entry;
    else data.push(entry);
    sessionStorage.setItem('session_watch_data', JSON.stringify(data.slice(-30)));
  } catch {}
};

export const VideoFeed = ({ searchQuery, categoryFilter, userId }: VideoFeedProps) => {
  const { hasEntered } = useEntryGate();
  const feedSource = searchQuery ? 'search' : categoryFilter ? 'category_feed' : 'main_feed';
  
  const [videos, setVideos] = useState<Video[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  // Scroll settle state (used only for preload, not for active playback)
  const [isScrollSettled, setIsScrollSettled] = useState(true);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActiveIndexRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const hasFetchedRef = useRef(false);
  const cursorRef = useRef<FeedCursor | null>(null);

  // Ad picker ref (stable across renders, regenerated when ads change)
  const adPickerRef = useRef<ReturnType<typeof createAdPicker>>(() => null);

  // Fetch active ads + their performance stats, then build the picker
  useEffect(() => {
    const fetchAds = async () => {
      try {
        const { data: adsData } = await supabase
          .from("ads")
          .select("id, title, video_url, thumbnail_url, external_link, cloudflare_video_id")
          .eq("is_active", true);
        const adsList: Ad[] = adsData || [];
        setAds(adsList);

        if (adsList.length === 0) return;

        // Fetch view & click counts for each ad
        const adIds = adsList.map(a => a.id);
        const [{ data: viewsData }, { data: clicksData }] = await Promise.all([
          supabase.from("ad_views").select("ad_id").in("ad_id", adIds),
          supabase.from("ad_clicks").select("ad_id").in("ad_id", adIds),
        ]);

        const statsMap = new Map<string, { views: number; clicks: number }>();
        adIds.forEach(id => statsMap.set(id, { views: 0, clicks: 0 }));
        (viewsData || []).forEach((r: { ad_id: string }) => {
          const s = statsMap.get(r.ad_id);
          if (s) s.views++;
        });
        (clicksData || []).forEach((r: { ad_id: string }) => {
          const s = statsMap.get(r.ad_id);
          if (s) s.clicks++;
        });

        adPickerRef.current = createAdPicker(adsList, statsMap);
      } catch (err) {
        console.error("[VideoFeed] Failed to fetch ads:", err);
      }
    };
    fetchAds();
  }, []);

  const feedEntries: FeedEntry[] = useMemo(() => {
    if (ads.length === 0) return videos.map(v => ({ type: 'video' as const, data: v }));
    const entries: FeedEntry[] = [];
    for (let i = 0; i < videos.length; i++) {
      entries.push({ type: 'video', data: videos[i] });
      if ((i + 1) % 10 === 0 && ads.length > 0) {
        const picked = adPickerRef.current();
        if (picked) entries.push({ type: 'ad', data: picked });
      }
    }
    return entries;
  }, [videos, ads]);

  // Fetch videos
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchVideos = async () => {
      try {
        if (searchQuery) {
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,cloudflare_video_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE * 2}`;
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
          const response = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
          let results = await response.json() || [];
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) || v.tags?.some(t => t.toLowerCase().includes(q))
          );
          results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(results.slice(0, PAGE_SIZE));
          setHasMore(results.length >= PAGE_SIZE);
        } else {
          const viewerId = getOrCreateViewerId();
          const sessionId = getOrCreateSessionId();
          const sessionViewedIds = getSessionViewedIds();
          const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId, viewerId, sessionId, cursor: null, limit: PAGE_SIZE, sessionViewedIds, categoryFilter: categoryFilter || null, sessionWatchData: getSessionWatchData() }
          });
          if (error) throw error;
          const resultVideos = data?.videos || [];
          cursorRef.current = data?.nextCursor || null;
          resultVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(resultVideos);
          setHasMore(data?.hasMore ?? resultVideos.length >= PAGE_SIZE);
          // Pre-warm HLS manifest for video[1] so transition is fast
          if (resultVideos.length > 1) {
            prefetchHlsManifest(resultVideos[1].cloudflare_video_id);
          }
        }
      } catch (err) {
        console.error("[VideoFeed] Fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load videos");
        setVideos([]);
      } finally {
        setLoading(false);
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
      cursorRef.current = null;
      if (containerRef.current) containerRef.current.scrollTop = 0;
      try {
        if (searchQuery) {
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,cloudflare_video_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&limit=${PAGE_SIZE}`;
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
          const response = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
          let results = await response.json() || [];
          const q = searchQuery.toLowerCase();
          results = results.filter((v: Video) =>
            v.title?.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q) ||
            v.profiles?.username?.toLowerCase().includes(q) || v.tags?.some(t => t.toLowerCase().includes(q))
          );
          results.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(results);
          setHasMore(results.length >= PAGE_SIZE);
        } else if (categoryFilter) {
          const viewerId = getOrCreateViewerId();
          const sessionId = getOrCreateSessionId();
          const sessionViewedIds = getSessionViewedIds();
          const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId, viewerId, sessionId, cursor: null, limit: PAGE_SIZE, sessionViewedIds, categoryFilter, sessionWatchData: getSessionWatchData() }
          });
          if (error) throw error;
          const resultVideos = data?.videos || [];
          cursorRef.current = data?.nextCursor || null;
          resultVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(resultVideos);
          setHasMore(data?.hasMore ?? resultVideos.length >= PAGE_SIZE);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load videos");
      } finally {
        setLoading(false);
      }
    };
    refetch();
  }, [searchQuery, categoryFilter]);

  // === SIMPLE ACTIVE INDEX DETECTION (scroll-snap aware) ===
  // We derive active index directly from scroll position for deterministic behavior.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || feedEntries.length === 0) return;

    const getItemHeight = () => container.clientHeight || window.innerHeight || 1;

    const updateFromScrollPosition = () => {
      const itemHeight = getItemHeight();
      const rawIndex = Math.round(container.scrollTop / itemHeight);
      const nextIndex = Math.max(0, Math.min(rawIndex, feedEntries.length - 1));

      if (nextIndex !== lastActiveIndexRef.current) {
        lastActiveIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
      }
    };

    const handleScroll = () => {
      setIsScrollSettled(false);

      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      scrollRafRef.current = requestAnimationFrame(updateFromScrollPosition);

      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = setTimeout(() => {
        updateFromScrollPosition();
        const idx = lastActiveIndexRef.current;
        setIsScrollSettled(true);
        if (feedEntries[idx]?.type === 'video') {
          addSessionViewedId(feedEntries[idx].data.id);
        }
      }, SCROLL_SETTLE_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    updateFromScrollPosition();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [feedEntries]);

  // Prefetch HLS manifests for upcoming videos when scroll settles
  useEffect(() => {
    if (!isScrollSettled) return;
    const next1 = activeIndex + 1;
    if (next1 < feedEntries.length && feedEntries[next1]?.type === 'video') {
      prefetchHlsManifest((feedEntries[next1].data as Video).cloudflare_video_id);
    }
    const next2 = activeIndex + 2;
    if (next2 < feedEntries.length && feedEntries[next2]?.type === 'video') {
      prefetchHlsManifest((feedEntries[next2].data as Video).cloudflare_video_id);
    }
  }, [activeIndex, feedEntries, isScrollSettled]);

  // Load more
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || videos.length === 0) return;
    if (activeIndex < feedEntries.length - 3) return;
    
    if (DEBUG_SCROLL) {
      console.log('[Pagination] Triggering load more:', { activeIndex, videosLength: videos.length, hasMore });
    }

    const loadMore = async () => {
      setIsLoadingMore(true);
      try {
        if (searchQuery) {
          const offset = videos.length;
          let url = `${SUPABASE_URL}/rest/v1/videos?select=id,title,description,video_url,optimized_video_url,stream_url,cloudinary_public_id,cloudflare_video_id,thumbnail_url,views_count,likes_count,tags,user_id,profiles(username,avatar_url)&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE}`;
          url += `&or=(title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%)`;
          const response = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
          const data = await response.json();
          const newVideos = (data || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(newVideos.length > 0);
        } else {
          const viewerId = getOrCreateViewerId();
          const sessionId = getOrCreateSessionId();
          const sessionViewedIds = getSessionViewedIds();
          const { data, error } = await supabase.functions.invoke('get-for-you-feed', {
            body: { userId, viewerId, sessionId, cursor: cursorRef.current, limit: PAGE_SIZE, sessionViewedIds, categoryFilter: categoryFilter || null, sessionWatchData: getSessionWatchData() }
          });
          if (error) throw error;
          const newVideos = (data?.videos || []).filter((v: Video) => !loadedIdsRef.current.has(v.id));
          newVideos.forEach((v: Video) => loadedIdsRef.current.add(v.id));
          cursorRef.current = data?.nextCursor || null;
          setVideos(prev => [...prev, ...newVideos]);
          setHasMore(data?.hasMore ?? newVideos.length > 0);
        }
      } catch (err) {
        console.error("Load more error:", err);
      } finally {
        setIsLoadingMore(false);
      }
    };
    loadMore();
  }, [activeIndex, feedEntries.length, hasMore, isLoadingMore, loading, searchQuery, categoryFilter, userId]);

  const handleViewTracked = useCallback((videoId: string, watchDuration?: number) => {
    addSessionViewedId(videoId);
    const video = videos.find(v => v.id === videoId);
    if (video && watchDuration !== undefined) {
      addSessionWatchData({ videoId, watchDuration, tags: video.tags || [] });
    }
  }, [videos]);

  const handleRetry = () => { window.location.reload(); };

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
        <button onClick={handleRetry} className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg">
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
      style={{ overscrollBehavior: 'none', scrollSnapType: 'y mandatory' }}
    >
      {feedEntries.map((entry, index) => {
        const isInRange = Math.abs(index - activeIndex) <= 2;
        const key = entry.type === 'ad' ? `ad-${entry.data.id}-${index}` : entry.data.id;
        
        if (!isInRange) {
          return (
            <div key={key} data-video-index={index}
              className="w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always" />
          );
        }
        
        if (entry.type === 'ad') {
          const shouldPreload = Math.abs(index - activeIndex) <= 1;
          return (
            <LivestreamAdItem key={key} ad={entry.data} index={index}
              isActive={index === activeIndex} shouldPreload={shouldPreload} currentUserId={userId} />
          );
        }

        const isItemActive = index === activeIndex;

        return (
          <FeedItem
            key={key}
            video={entry.data}
            index={index}
            isActive={isItemActive}
            hasEntered={hasEntered}
            currentUserId={userId}
            feedSource={feedSource}
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
