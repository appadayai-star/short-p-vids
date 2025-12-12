-- Add stream_url column for HLS adaptive streaming
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS stream_url TEXT;