import { useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Session ID logic: a session is a continuous viewing period
// Sessions expire after 30 minutes of inactivity (matches backend definition)
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

const getOrCreateSessionId = (): string => {
  const key = 'video_session_v1';
  const lastActivityKey = 'video_session_last_activity';
  
  const now = Date.now();
  const lastActivity = parseInt(localStorage.getItem(lastActivityKey) || '0', 10);
  let sessionId = localStorage.getItem(key);
  
  // If session expired or doesn't exist, create new one
  if (!sessionId || (now - lastActivity) > SESSION_EXPIRY_MS) {
    sessionId = `session_${now}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(key, sessionId);
    // Reset session video count on new session
    localStorage.setItem('session_video_count', '0');
    localStorage.setItem('session_max_scroll_depth', '0');
  }
  
  // Update last activity
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
  userId: string | null;
  sessionId: string;
  watchDurationSeconds: number;
  videoDurationSeconds: number | null;
  watchCompletionPercent: number | null;
  timeToFirstFrameMs: number | null;
}

interface UseWatchMetricsProps {
  videoId: string;
  userId: string | null;
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
    // This is more accurate than wall-clock time and handles seeking/looping
    const handleTimeUpdate = () => {
      if (!isActivelyPlayingRef.current) return;
      
      const currentVideoTime = videoEl.currentTime;
      const timeDelta = currentVideoTime - lastVideoTimeRef.current;
      
      // Only count forward progress (ignore seeks backward, loops)
      // Accept small positive deltas (normal playback) up to 1 second
      if (timeDelta > 0 && timeDelta < 1) {
        totalWatchTimeRef.current += timeDelta;
      }
      
      lastVideoTimeRef.current = currentVideoTime;
    };

    // Loop: video looped - don't double count, just continue from 0
    const handleSeeked = () => {
      // Reset video time reference after seek/loop
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

  // Get current metrics
  const getMetrics = useCallback((): WatchMetrics => {
    const videoEl = videoRef.current;
    const watchedSeconds = totalWatchTimeRef.current;

    const videoDuration = videoEl?.duration && !isNaN(videoEl.duration) && isFinite(videoEl.duration) 
      ? videoEl.duration 
      : null;
    
    let completionPercent: number | null = null;
    
    if (videoDuration && videoDuration > 0 && watchedSeconds > 0) {
      // Cap at 100% - no double counting for loops
      completionPercent = Math.min(100, Math.round((watchedSeconds / videoDuration) * 100));
    }

    return {
      videoId,
      userId,
      sessionId: getOrCreateSessionId(),
      watchDurationSeconds: Math.round(watchedSeconds),
      videoDurationSeconds: videoDuration ? Math.round(videoDuration) : null,
      watchCompletionPercent: completionPercent,
      timeToFirstFrameMs: ttffRef.current,
    };
  }, [videoId, userId, videoRef]);

  // Send metrics to database
  const sendMetrics = useCallback(async () => {
    // Don't record the same view twice
    if (hasRecordedViewRef.current) return;
    
    const metrics = getMetrics();
    
    // Only send if we have meaningful data (watched something or have TTFF)
    if (metrics.watchDurationSeconds <= 0 && metrics.timeToFirstFrameMs === null) {
      return;
    }

    hasRecordedViewRef.current = true;
    
    // Increment session video count
    incrementSessionVideoCount();

    try {
      await supabase.from('video_views').insert({
        video_id: metrics.videoId,
        user_id: metrics.userId,
        session_id: metrics.sessionId,
        watch_duration_seconds: metrics.watchDurationSeconds,
        video_duration_seconds: metrics.videoDurationSeconds,
        watch_completion_percent: metrics.watchCompletionPercent,
        time_to_first_frame_ms: metrics.timeToFirstFrameMs,
      });

      onViewRecorded?.();
      
      if (import.meta.env.DEV) {
        console.log('[Metrics] View recorded:', {
          videoId: metrics.videoId,
          ttff: metrics.timeToFirstFrameMs,
          watchDuration: metrics.watchDurationSeconds,
          completion: metrics.watchCompletionPercent,
        });
      }
    } catch (error) {
      console.error('[Metrics] Failed to record view:', error);
      // Reset so we can try again
      hasRecordedViewRef.current = false;
    }
  }, [getMetrics, onViewRecorded]);

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

  // Send metrics on unmount
  useEffect(() => {
    return () => {
      isActivelyPlayingRef.current = false;
      if (!hasRecordedViewRef.current && totalWatchTimeRef.current > 0) {
        // Fire and forget on unmount
        const metrics = getMetrics();
        if (metrics.watchDurationSeconds > 0 || metrics.timeToFirstFrameMs !== null) {
          incrementSessionVideoCount();
          supabase.from('video_views').insert({
            video_id: metrics.videoId,
            user_id: metrics.userId,
            session_id: metrics.sessionId,
            watch_duration_seconds: metrics.watchDurationSeconds,
            video_duration_seconds: metrics.videoDurationSeconds,
            watch_completion_percent: metrics.watchCompletionPercent,
            time_to_first_frame_ms: metrics.timeToFirstFrameMs,
          }).then(() => {
            if (import.meta.env.DEV) {
              console.log('[Metrics] View recorded on unmount');
            }
          });
        }
      }
    };
  }, []);

  return {
    markLoadStart,
    stopWatching,
    sendMetrics,
    getMetrics,
  };
};
