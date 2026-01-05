-- Add processing_error column to track why video processing failed
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Add index for finding broken videos that need reprocessing
CREATE INDEX IF NOT EXISTS idx_videos_processing_status ON public.videos(processing_status);
CREATE INDEX IF NOT EXISTS idx_videos_needs_reprocess ON public.videos(cloudinary_public_id) WHERE cloudinary_public_id IS NOT NULL AND optimized_video_url IS NULL;