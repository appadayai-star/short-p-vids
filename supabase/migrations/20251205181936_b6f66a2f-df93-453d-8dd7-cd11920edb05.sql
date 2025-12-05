-- Add columns for optimized video URLs and processing status
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS optimized_video_url text,
ADD COLUMN IF NOT EXISTS thumbnail_generated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending';