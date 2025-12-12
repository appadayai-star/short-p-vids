-- Add cloudinary_public_id column to store the Cloudinary asset ID
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;