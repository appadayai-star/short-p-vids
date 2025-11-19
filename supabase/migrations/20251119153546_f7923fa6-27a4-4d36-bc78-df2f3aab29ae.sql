-- Create notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'save', 'follow')),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_is_read ON public.notifications(user_id, is_read);

-- Function to create like notification
CREATE OR REPLACE FUNCTION public.create_like_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  video_owner_id UUID;
BEGIN
  -- Get the video owner
  SELECT user_id INTO video_owner_id
  FROM public.videos
  WHERE id = NEW.video_id;
  
  -- Don't create notification if user likes their own video
  IF video_owner_id != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, actor_id, video_id)
    VALUES (video_owner_id, 'like', NEW.user_id, NEW.video_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to create comment notification
CREATE OR REPLACE FUNCTION public.create_comment_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  video_owner_id UUID;
BEGIN
  -- Get the video owner
  SELECT user_id INTO video_owner_id
  FROM public.videos
  WHERE id = NEW.video_id;
  
  -- Don't create notification if user comments on their own video
  IF video_owner_id != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, actor_id, video_id, comment_id)
    VALUES (video_owner_id, 'comment', NEW.user_id, NEW.video_id, NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to create save notification
CREATE OR REPLACE FUNCTION public.create_save_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  video_owner_id UUID;
BEGIN
  -- Get the video owner
  SELECT user_id INTO video_owner_id
  FROM public.videos
  WHERE id = NEW.video_id;
  
  -- Don't create notification if user saves their own video
  IF video_owner_id != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, actor_id, video_id)
    VALUES (video_owner_id, 'save', NEW.user_id, NEW.video_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to create follow notification
CREATE OR REPLACE FUNCTION public.create_follow_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, actor_id)
  VALUES (NEW.following_id, 'follow', NEW.follower_id);
  
  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER create_like_notification_trigger
  AFTER INSERT ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.create_like_notification();

CREATE TRIGGER create_comment_notification_trigger
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_comment_notification();

CREATE TRIGGER create_save_notification_trigger
  AFTER INSERT ON public.saved_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.create_save_notification();

CREATE TRIGGER create_follow_notification_trigger
  AFTER INSERT ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.create_follow_notification();