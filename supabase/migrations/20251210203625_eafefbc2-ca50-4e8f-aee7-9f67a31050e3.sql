-- Create trigger function to increment views_count when a view is recorded
CREATE OR REPLACE FUNCTION public.increment_video_views_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.videos 
  SET views_count = views_count + 1 
  WHERE id = NEW.video_id;
  RETURN NEW;
END;
$$;

-- Create trigger on video_views table
DROP TRIGGER IF EXISTS trigger_increment_video_views ON public.video_views;
CREATE TRIGGER trigger_increment_video_views
  AFTER INSERT ON public.video_views
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_video_views_count();

-- Sync the current views_count with actual video_views count
UPDATE public.videos v
SET views_count = (
  SELECT COUNT(*) 
  FROM public.video_views vv 
  WHERE vv.video_id = v.id
);