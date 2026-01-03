-- Create a table to track guest/anonymous likes
CREATE TABLE public.guest_likes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_id TEXT NOT NULL,
  video_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add unique constraint to prevent duplicate likes from same guest
CREATE UNIQUE INDEX guest_likes_guest_video_unique ON public.guest_likes(guest_id, video_id);

-- Enable RLS
ALTER TABLE public.guest_likes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (edge function uses service role anyway)
CREATE POLICY "Anyone can insert guest likes"
ON public.guest_likes
FOR INSERT
WITH CHECK (true);

-- Allow anyone to read (for admin stats)
CREATE POLICY "Guest likes are viewable by everyone"
ON public.guest_likes
FOR SELECT
USING (true);

-- Allow delete for unlike functionality
CREATE POLICY "Anyone can delete guest likes"
ON public.guest_likes
FOR DELETE
USING (true);