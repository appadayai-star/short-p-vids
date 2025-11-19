-- Create table to track user category preferences based on interactions
CREATE TABLE IF NOT EXISTS public.user_category_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  interaction_score NUMERIC DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  last_interaction TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, category)
);

-- Enable RLS
ALTER TABLE public.user_category_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own category preferences"
  ON public.user_category_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own category preferences"
  ON public.user_category_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own category preferences"
  ON public.user_category_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Add watch_duration_seconds to video_views to track how long users watched
ALTER TABLE public.video_views
ADD COLUMN IF NOT EXISTS watch_duration_seconds INTEGER DEFAULT 0;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_category_preferences_user_id ON public.user_category_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_category_preferences_category ON public.user_category_preferences(category);
CREATE INDEX IF NOT EXISTS idx_videos_tags ON public.videos USING GIN(tags);

-- Function to update category preferences automatically
CREATE OR REPLACE FUNCTION public.update_category_preference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  video_tags TEXT[];
  tag TEXT;
  base_score NUMERIC;
BEGIN
  -- Get video tags
  SELECT tags INTO video_tags FROM public.videos WHERE id = NEW.video_id;
  
  IF video_tags IS NULL OR array_length(video_tags, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine base score based on interaction type
  base_score := CASE TG_TABLE_NAME
    WHEN 'video_views' THEN 1.0
    WHEN 'likes' THEN 5.0
    WHEN 'comments' THEN 10.0
    WHEN 'saved_videos' THEN 8.0
    ELSE 1.0
  END;

  -- Update preference for each category/tag
  FOREACH tag IN ARRAY video_tags LOOP
    INSERT INTO public.user_category_preferences (
      user_id, 
      category, 
      interaction_score,
      view_count,
      like_count,
      comment_count,
      share_count,
      last_interaction
    )
    VALUES (
      NEW.user_id,
      tag,
      base_score,
      CASE WHEN TG_TABLE_NAME = 'video_views' THEN 1 ELSE 0 END,
      CASE WHEN TG_TABLE_NAME = 'likes' THEN 1 ELSE 0 END,
      CASE WHEN TG_TABLE_NAME = 'comments' THEN 1 ELSE 0 END,
      CASE WHEN TG_TABLE_NAME = 'saved_videos' THEN 1 ELSE 0 END,
      now()
    )
    ON CONFLICT (user_id, category) 
    DO UPDATE SET
      interaction_score = user_category_preferences.interaction_score + base_score,
      view_count = user_category_preferences.view_count + CASE WHEN TG_TABLE_NAME = 'video_views' THEN 1 ELSE 0 END,
      like_count = user_category_preferences.like_count + CASE WHEN TG_TABLE_NAME = 'likes' THEN 1 ELSE 0 END,
      comment_count = user_category_preferences.comment_count + CASE WHEN TG_TABLE_NAME = 'comments' THEN 1 ELSE 0 END,
      share_count = user_category_preferences.share_count + CASE WHEN TG_TABLE_NAME = 'saved_videos' THEN 1 ELSE 0 END,
      last_interaction = now(),
      updated_at = now();
  END LOOP;

  RETURN NEW;
END;
$$;

-- Create triggers to update category preferences
DROP TRIGGER IF EXISTS update_category_on_view ON public.video_views;
CREATE TRIGGER update_category_on_view
  AFTER INSERT ON public.video_views
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.update_category_preference();

DROP TRIGGER IF EXISTS update_category_on_like ON public.likes;
CREATE TRIGGER update_category_on_like
  AFTER INSERT ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_category_preference();

DROP TRIGGER IF EXISTS update_category_on_comment ON public.comments;
CREATE TRIGGER update_category_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_category_preference();

DROP TRIGGER IF EXISTS update_category_on_save ON public.saved_videos;
CREATE TRIGGER update_category_on_save
  AFTER INSERT ON public.saved_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_category_preference();