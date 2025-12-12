-- Index for faster feed ordering
CREATE INDEX IF NOT EXISTS idx_videos_created_at_desc ON public.videos (created_at DESC);

-- Index for faster viewed video lookups
CREATE INDEX IF NOT EXISTS idx_video_views_user_video ON public.video_views (user_id, video_id);