-- Add watch time and TTFF tracking columns to video_views
ALTER TABLE public.video_views 
  ADD COLUMN IF NOT EXISTS video_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS watch_completion_percent decimal(5,2),
  ADD COLUMN IF NOT EXISTS time_to_first_frame_ms integer;

-- Create shares table for tracking shares (anonymous and logged-in)
CREATE TABLE IF NOT EXISTS public.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id text,
  share_type text NOT NULL DEFAULT 'copy_link', -- 'copy_link', 'whatsapp', etc.
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create profile_views table
CREATE TABLE IF NOT EXISTS public.profile_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

-- RLS policies for shares (anyone can insert, viewable by everyone)
CREATE POLICY "Anyone can track shares" ON public.shares FOR INSERT WITH CHECK (true);
CREATE POLICY "Shares are viewable by everyone" ON public.shares FOR SELECT USING (true);

-- RLS policies for profile_views
CREATE POLICY "Anyone can track profile views" ON public.profile_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Profile views are viewable by profile owner" ON public.profile_views FOR SELECT USING (auth.uid() = profile_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shares_video_id ON public.shares(video_id);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON public.shares(created_at);
CREATE INDEX IF NOT EXISTS idx_profile_views_profile_id ON public.profile_views(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_created_at ON public.profile_views(created_at);
CREATE INDEX IF NOT EXISTS idx_video_views_watch_completion ON public.video_views(watch_completion_percent);
CREATE INDEX IF NOT EXISTS idx_video_views_ttff ON public.video_views(time_to_first_frame_ms);