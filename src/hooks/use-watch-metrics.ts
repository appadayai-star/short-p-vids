import { useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Session expiry: 30 minutes of inactivity
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// Get or create PERSISTENT anonymous ID (never expires)
// This identifies the unique visitor across all sessions
const getOrCreateAnonymousId = (): string => {
  const key = 'anonymous_viewer_id_v1';
  let anonymousId = localStorage.getItem(key);
  
  if (!anonymousId) {
    // Generate UUID-like ID
    anonymousId = crypto.randomUUID ? crypto.randomUUID() : 
      `anon_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(key, anonymousId);
  }
  
  return anonymousId;
};

// Get or create session ID (expires after 30 min inactivity)
// This groups views into "sessions" for session-based analytics
const getOrCreateSessionId = (): string => {
  const key = 'video_session_v2';
  const lastActivityKey = 'video_session_last_activity';
  
  const now = Date.now();
  const lastActivity = parseInt(localStorage.getItem(lastActivityKey) || '0', 10);
  let sessionId = localStorage.getItem(key);
  
  // If session expired or doesn't exist, create new one
  if (!sessionId || (now - lastActivity) > SESSION_EXPIRY_MS) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : 
      `sess_${now}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(key, sessionId);
    // Reset session-level counters
    localStorage.setItem('session_video_count', '0');
    localStorage.setItem('session_max_scroll_depth', '0');
  }
  
  // Update last activity timestamp
  localStorage.setItem(lastActivityKey, now.toString());
  
  return sessionId;
};

// Track videos per session
const incrementSessionVideoCount = (): number => {
  const count = parseInt(localStorage.getItem('session_video_count') || '0', 10) + 1;
  localStorage.setItem('session_video_count', count.toString());
  return count;
};

// Track scroll depth (max index reached in session)
const updateScrollDepth = (index: number): void => {
  const current = parseInt(localStorage.getItem('session_max_scroll_depth') || '0', 10);
  if (index > current) {
    localStorage.setItem('session_max_scroll_depth', index.toString());
  }
};

interface WatchMetrics {
  videoId: string;
  viewerId: string; // auth.user.id OR anonymous_id (ALWAYS filled)
  sessionId: string; // ALWAYS filled
  authUserId: string | null; // Only filled for logged-in users
  watchDurationSeconds: number;
  videoDurationSeconds: number | null;
  watchCompletionPercent: number | null;
  timeToFirstFrameMs: number | null;
}

interface UseWatchMetricsProps {
  videoId: string;
  userId: string | null; // auth.user.id (null if not logged in)
  isActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoIndex?: number;
  onViewRecorded?: () => void;
}

export const useWatchMetrics = ({
  videoId,
  userId,
  isActive,
  videoRef,
  videoIndex = 0,
  onViewRecorded,
}: UseWatchMetricsProps) => {
  // Timing refs
  const loadStartTimeRef = useRef<number>(0);
  const ttffRef = useRef<number | null>(null);
  const ttffRecordedRef = useRef(false);
  
  // Watch time tracking - use timeupdate deltas for accuracy
  const lastTimeUpdateRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(0);
  const totalWatchTimeRef = useRef<number>(0);
  const isActivelyPlayingRef = useRef(false);
  
  // View recording
  const hasRecordedViewRef = useRef(false);
  const lastVideoIdRef = useRef<string>(videoId);
  
  // Store metrics for pagehide event
  const pendingMetricsRef = useRef<WatchMetrics | null>(null);

  // Reset when video changes
  useEffect(() => {
    if (lastVideoIdRef.current !== videoId) {
      ttffRef.current = null;
      ttffRecordedRef.current = false;
      totalWatchTimeRef.current = 0;
      hasRecordedViewRef.current = false;
      isActivelyPlayingRef.current = false;
      lastTimeUpdateRef.current = 0;
      lastVideoTimeRef.current = 0;
      lastVideoIdRef.current = videoId;
      pendingMetricsRef.current = null;
    }
  }, [videoId]);

  // Track scroll depth when becoming active
  useEffect(() => {
    if (isActive) {
      updateScrollDepth(videoIndex);
    }
  }, [isActive, videoIndex]);

  // Mark load start when becoming active
  const markLoadStart = useCallback(() => {
    loadStartTimeRef.current = performance.now();
    ttffRecordedRef.current = false;
  }, []);

  // Setup video event listeners for accurate tracking
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !isActive) return;

    // TTFF: Record on first 'playing' event (actual frame rendered)
    const handlePlaying = () => {
      if (!ttffRecordedRef.current && loadStartTimeRef.current > 0) {
        ttffRef.current = Math.round(performance.now() - loadStartTimeRef.current);
        ttffRecordedRef.current = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Metrics] TTFF recorded: ${ttffRef.current}ms for video ${videoId}`);
        }
      }
      isActivelyPlayingRef.current = true;
      lastTimeUpdateRef.current = performance.now();
      lastVideoTimeRef.current = videoEl.currentTime;
    };

    // Pause: stop counting
    const handlePause = () => {
      isActivelyPlayingRef.current = false;
    };

    // Waiting/buffering: stop counting
    const handleWaiting = () => {
      isActivelyPlayingRef.current = false;
    };

    // Timeupdate: accumulate watch time using video time deltas
    const handleTimeUpdate = () => {
      if (!isActivelyPlayingRef.current) return;
      
      const currentVideoTime = videoEl.currentTime;
      const timeDelta = currentVideoTime - lastVideoTimeRef.current;
      
      // Only count forward progress (ignore seeks backward, loops)
      if (timeDelta > 0 && timeDelta < 1) {
        totalWatchTimeRef.current += timeDelta;
      }
      
      lastVideoTimeRef.current = currentVideoTime;
    };

    // Seek/loop: reset video time reference
    const handleSeeked = () => {
      lastVideoTimeRef.current = videoEl.currentTime;
    };

    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('pause', handlePause);
    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('timeupdate', handleTimeUpdate);
    videoEl.addEventListener('seeked', handleSeeked);

    return () => {
      videoEl.removeEventListener('playing', handlePlaying);
      videoEl.removeEventListener('pause', handlePause);
      videoEl.removeEventListener('waiting', handleWaiting);
      videoEl.removeEventListener('timeupdate', handleTimeUpdate);
      videoEl.removeEventListener('seeked', handleSeeked);
    };
  }, [isActive, videoId, videoRef]);

  // Visibility change: stop counting when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isActivelyPlayingRef.current = false;
      } else if (videoRef.current && !videoRef.current.paused) {
        isActivelyPlayingRef.current = true;
        lastVideoTimeRef.current = videoRef.current.currentTime;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [videoRef]);

  // Get current metrics - ALWAYS includes viewer_id and session_id
  const getMetrics = useCallback((): WatchMetrics => {
    const videoEl = videoRef.current;
    const watchedSeconds = totalWatchTimeRef.current;
    
    // Get identifiers - these are ALWAYS filled
    const anonymousId = getOrCreateAnonymousId();
    const sessionId = getOrCreateSessionId();
    const viewerId = userId || anonymousId; // Prefer auth user, fall back to anonymous

    const videoDuration = videoEl?.duration && !isNaN(videoEl.duration) && isFinite(videoEl.duration) 
      ? videoEl.duration 
      : null;
    
    let completionPercent: number | null = null;
    
    if (videoDuration && videoDuration > 0 && watchedSeconds > 0) {
      completionPercent = Math.min(100, Math.round((watchedSeconds / videoDuration) * 100));
    }

    return {
      videoId,
      viewerId,
      sessionId,
      authUserId: userId,
      watchDurationSeconds: Math.round(watchedSeconds),
      videoDurationSeconds: videoDuration ? Math.round(videoDuration) : null,
      watchCompletionPercent: completionPercent,
      timeToFirstFrameMs: ttffRef.current,
    };
  }, [videoId, userId, videoRef]);

  // Send metrics to database
  const sendMetrics = useCallback(async () => {
    if (hasRecordedViewRef.current) return;
    
    const metrics = getMetrics();
    
    // Only send if watched > 0s OR have TTFF (minimum meaningful data)
    if (metrics.watchDurationSeconds <= 0 && metrics.timeToFirstFrameMs === null) {
      return;
    }

    hasRecordedViewRef.current = true;
    pendingMetricsRef.current = null;
    
    incrementSessionVideoCount();

    try {
      // Store viewer_id in user_id column (works for both auth and anonymous)
      // Store session_id ALWAYS
      await supabase.from('video_views').insert({
        video_id: metrics.videoId,
        user_id: metrics.viewerId, // Always filled: auth.user.id OR anonymous_id
        session_id: metrics.sessionId, // Always filled
        watch_duration_seconds: metrics.watchDurationSeconds,
        video_duration_seconds: metrics.videoDurationSeconds,
        watch_completion_percent: metrics.watchCompletionPercent,
        time_to_first_frame_ms: metrics.timeToFirstFrameMs,
      });

      onViewRecorded?.();
      
      if (import.meta.env.DEV) {
        console.log('[Metrics] View recorded:', {
          videoId: metrics.videoId,
          viewerId: metrics.viewerId,
          sessionId: metrics.sessionId,
          ttff: metrics.timeToFirstFrameMs,
          watchDuration: metrics.watchDurationSeconds,
          completion: metrics.watchCompletionPercent,
        });
      }
    } catch (error) {
      console.error('[Metrics] Failed to record view:', error);
      hasRecordedViewRef.current = false;
    }
  }, [getMetrics, onViewRecorded]);

  // Beacon-based send for pagehide (best effort)
  const sendMetricsBeacon = useCallback(() => {
    if (hasRecordedViewRef.current) return;
    
    const metrics = getMetrics();
    if (metrics.watchDurationSeconds <= 0 && metrics.timeToFirstFrameMs === null) {
      return;
    }
    
    hasRecordedViewRef.current = true;

    // Use sendBeacon for reliability during page unload
    const payload = JSON.stringify({
      video_id: metrics.videoId,
      user_id: metrics.viewerId,
      session_id: metrics.sessionId,
      watch_duration_seconds: metrics.watchDurationSeconds,
      video_duration_seconds: metrics.videoDurationSeconds,
      watch_completion_percent: metrics.watchCompletionPercent,
      time_to_first_frame_ms: metrics.timeToFirstFrameMs,
    });

    // Try sendBeacon first (most reliable for unload)
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/video_views`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      'Prefer': 'return=minimal',
    };

    // Create a Blob for sendBeacon
    const blob = new Blob([payload], { type: 'application/json' });
    
    // Try navigator.sendBeacon (works during unload)
    if (navigator.sendBeacon) {
      // sendBeacon doesn't support custom headers, so use fetch with keepalive
      fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        keepalive: true,
      }).catch(() => {
        // Silent fail - best effort
      });
    } else {
      // Fallback to fetch with keepalive
      fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
    
    if (import.meta.env.DEV) {
      console.log('[Metrics] Beacon sent on pagehide:', metrics.videoId);
    }
  }, [getMetrics]);

  // Stop watching helper
  const stopWatching = useCallback(() => {
    isActivelyPlayingRef.current = false;
  }, []);

  // Send metrics when scrolling away (isActive becomes false)
  useEffect(() => {
    if (!isActive && !hasRecordedViewRef.current && totalWatchTimeRef.current > 0) {
      stopWatching();
      sendMetrics();
    }
  }, [isActive, stopWatching, sendMetrics]);

  // Handle pagehide event (tab close, navigation, etc.)
  useEffect(() => {
    const handlePageHide = () => {
      if (!hasRecordedViewRef.current && totalWatchTimeRef.current > 0) {
        isActivelyPlayingRef.current = false;
        sendMetricsBeacon();
      }
    };

    // pagehide is more reliable than beforeunload for mobile
    window.addEventListener('pagehide', handlePageHide);
    
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [sendMetricsBeacon]);

  // Send metrics on unmount
  useEffect(() => {
    return () => {
      isActivelyPlayingRef.current = false;
      if (!hasRecordedViewRef.current && totalWatchTimeRef.current > 0) {
        // Get metrics synchronously before unmount
        const videoEl = videoRef.current;
        const watchedSeconds = totalWatchTimeRef.current;
        const anonymousId = getOrCreateAnonymousId();
        const sessionId = getOrCreateSessionId();
        const viewerId = userId || anonymousId;
        
        const videoDuration = videoEl?.duration && !isNaN(videoEl.duration) && isFinite(videoEl.duration) 
          ? videoEl.duration 
          : null;
        
        let completionPercent: number | null = null;
        if (videoDuration && videoDuration > 0 && watchedSeconds > 0) {
          completionPercent = Math.min(100, Math.round((watchedSeconds / videoDuration) * 100));
        }
        
        if (Math.round(watchedSeconds) > 0 || ttffRef.current !== null) {
          incrementSessionVideoCount();
          
          // Fire and forget on unmount
          supabase.from('video_views').insert({
            video_id: videoId,
            user_id: viewerId,
            session_id: sessionId,
            watch_duration_seconds: Math.round(watchedSeconds),
            video_duration_seconds: videoDuration ? Math.round(videoDuration) : null,
            watch_completion_percent: completionPercent,
            time_to_first_frame_ms: ttffRef.current,
          }).then(() => {
            if (import.meta.env.DEV) {
              console.log('[Metrics] View recorded on unmount');
            }
          });
        }
      }
    };
  }, [videoId, userId]);

  return {
    markLoadStart,
    stopWatching,
    sendMetrics,
    getMetrics,
  };
};
