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
  }
  
  // Update last activity
  localStorage.setItem(lastActivityKey, now.toString());
  
  return sessionId;
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
  onViewRecorded?: () => void;
}

export const useWatchMetrics = ({
  videoId,
  userId,
  isActive,
  videoRef,
  onViewRecorded,
}: UseWatchMetricsProps) => {
  // Timing refs
  const loadStartTimeRef = useRef<number>(0);
  const ttffRef = useRef<number | null>(null);
  const watchStartTimeRef = useRef<number>(0);
  const totalWatchTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const hasRecordedViewRef = useRef(false);
  const lastVideoIdRef = useRef<string>(videoId);

  // Reset when video changes
  useEffect(() => {
    if (lastVideoIdRef.current !== videoId) {
      ttffRef.current = null;
      totalWatchTimeRef.current = 0;
      hasRecordedViewRef.current = false;
      isPlayingRef.current = false;
      lastVideoIdRef.current = videoId;
    }
  }, [videoId]);

  // Mark load start when becoming active
  const markLoadStart = useCallback(() => {
    loadStartTimeRef.current = performance.now();
  }, []);

  // Mark first frame (TTFF)
  const markFirstFrame = useCallback(() => {
    if (loadStartTimeRef.current && ttffRef.current === null) {
      ttffRef.current = Math.round(performance.now() - loadStartTimeRef.current);
    }
  }, []);

  // Start watching timer
  const startWatching = useCallback(() => {
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      watchStartTimeRef.current = performance.now();
    }
  }, []);

  // Pause watching timer
  const pauseWatching = useCallback(() => {
    if (isPlayingRef.current && watchStartTimeRef.current) {
      const elapsed = (performance.now() - watchStartTimeRef.current) / 1000;
      totalWatchTimeRef.current += elapsed;
      isPlayingRef.current = false;
    }
  }, []);

  // Get current metrics
  const getMetrics = useCallback((): WatchMetrics => {
    const videoEl = videoRef.current;
    let currentWatchTime = totalWatchTimeRef.current;
    
    // Add ongoing watch time if still playing
    if (isPlayingRef.current && watchStartTimeRef.current) {
      currentWatchTime += (performance.now() - watchStartTimeRef.current) / 1000;
    }

    const videoDuration = videoEl?.duration && !isNaN(videoEl.duration) ? videoEl.duration : null;
    let completionPercent: number | null = null;
    
    if (videoDuration && videoDuration > 0 && currentWatchTime > 0) {
      // Cap at 100% for looped videos
      completionPercent = Math.min(100, Math.round((currentWatchTime / videoDuration) * 100));
    }

    return {
      videoId,
      userId,
      sessionId: getOrCreateSessionId(),
      watchDurationSeconds: Math.round(currentWatchTime),
      videoDurationSeconds: videoDuration ? Math.round(videoDuration) : null,
      watchCompletionPercent: completionPercent,
      timeToFirstFrameMs: ttffRef.current,
    };
  }, [videoId, userId, videoRef]);

  // Send metrics to database
  const sendMetrics = useCallback(async () => {
    const metrics = getMetrics();
    
    // Only send if we have meaningful data
    if (metrics.watchDurationSeconds <= 0 && metrics.timeToFirstFrameMs === null) {
      return;
    }

    // Don't record the same view twice
    if (hasRecordedViewRef.current) {
      // Update existing view with watch metrics
      // For now, we insert a new record as the view was already recorded
      // In future, we could UPDATE the existing view row
      return;
    }

    hasRecordedViewRef.current = true;

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
    }
  }, [getMetrics, onViewRecorded]);

  // Send metrics when scrolling away (isActive becomes false)
  useEffect(() => {
    if (!isActive && hasRecordedViewRef.current === false && totalWatchTimeRef.current > 0) {
      // Pause any ongoing watching
      pauseWatching();
      sendMetrics();
    }
  }, [isActive, pauseWatching, sendMetrics]);

  // Send metrics on unmount
  useEffect(() => {
    return () => {
      pauseWatching();
      if (!hasRecordedViewRef.current && totalWatchTimeRef.current > 0) {
        // Fire and forget on unmount
        const metrics = getMetrics();
        if (metrics.watchDurationSeconds > 0) {
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
    markFirstFrame,
    startWatching,
    pauseWatching,
    sendMetrics,
    getMetrics,
  };
};
