-- Create follows table for following/followers functionality
CREATE TABLE public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Enable RLS on follows
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Follows policies
CREATE POLICY "Follows are viewable by everyone"
  ON public.follows FOR SELECT
  USING (true);

CREATE POLICY "Users can follow others"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Add follower/following counts to profiles
ALTER TABLE public.profiles
ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;

-- Function to update follower counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment following count for follower
    UPDATE public.profiles 
    SET following_count = following_count + 1 
    WHERE id = NEW.follower_id;
    
    -- Increment followers count for followed user
    UPDATE public.profiles 
    SET followers_count = followers_count + 1 
    WHERE id = NEW.following_id;
    
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement following count for follower
    UPDATE public.profiles 
    SET following_count = following_count - 1 
    WHERE id = OLD.follower_id;
    
    -- Decrement followers count for followed user
    UPDATE public.profiles 
    SET followers_count = followers_count - 1 
    WHERE id = OLD.following_id;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Trigger for follow counts
CREATE TRIGGER update_follow_counts_trigger
AFTER INSERT OR DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Create indexes for performance
CREATE INDEX idx_follows_follower_id ON public.follows(follower_id);
CREATE INDEX idx_follows_following_id ON public.follows(following_id);