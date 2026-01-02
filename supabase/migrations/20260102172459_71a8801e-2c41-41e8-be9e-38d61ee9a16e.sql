-- Create function to increment likes count for guest users
CREATE OR REPLACE FUNCTION public.increment_likes_count(video_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.videos 
  SET likes_count = likes_count + 1 
  WHERE id = video_id_param;
END;
$$;

-- Create function to decrement likes count for guest users (with floor at 0)
CREATE OR REPLACE FUNCTION public.decrement_likes_count(video_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.videos 
  SET likes_count = GREATEST(likes_count - 1, 0) 
  WHERE id = video_id_param;
END;
$$;