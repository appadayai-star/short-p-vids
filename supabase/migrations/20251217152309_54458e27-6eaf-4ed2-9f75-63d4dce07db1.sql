-- Add viewer_id column for combined identity (auth user OR anonymous)
-- user_id remains auth-only (nullable, FK to profiles)
ALTER TABLE public.video_views 
ADD COLUMN IF NOT EXISTS viewer_id text;

-- Add index for efficient unique viewer queries
CREATE INDEX IF NOT EXISTS idx_video_views_viewer_id ON public.video_views(viewer_id);

-- Comment for clarity
COMMENT ON COLUMN public.video_views.viewer_id IS 'Combined viewer identity: auth.user.id for logged-in users, anonymous_id for guests. Always filled.';
COMMENT ON COLUMN public.video_views.user_id IS 'Auth user ID only. NULL for anonymous users. FK to profiles.';
COMMENT ON COLUMN public.video_views.session_id IS 'Session ID. Expires after 30 min inactivity. Always filled for tracked views.';