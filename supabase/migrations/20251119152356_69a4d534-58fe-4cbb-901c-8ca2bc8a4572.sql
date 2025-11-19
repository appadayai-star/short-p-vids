-- Create saved_videos table
CREATE TABLE public.saved_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(video_id, user_id)
);

-- Enable RLS
ALTER TABLE public.saved_videos ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own saved videos"
  ON public.saved_videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can save videos"
  ON public.saved_videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unsave videos"
  ON public.saved_videos FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for better performance
CREATE INDEX idx_saved_videos_user_id ON public.saved_videos(user_id);
CREATE INDEX idx_saved_videos_video_id ON public.saved_videos(video_id);