-- Add session_id to video_views for tracking anonymous sessions
ALTER TABLE public.video_views 
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add index for session-based queries
CREATE INDEX IF NOT EXISTS idx_video_views_session_id ON public.video_views(session_id);

-- Add index for user return rate queries (user_id + viewed_at)
CREATE INDEX IF NOT EXISTS idx_video_views_user_viewed ON public.video_views(user_id, viewed_at);

-- Add index for unique viewers queries
CREATE INDEX IF NOT EXISTS idx_video_views_viewed_at ON public.video_views(viewed_at);