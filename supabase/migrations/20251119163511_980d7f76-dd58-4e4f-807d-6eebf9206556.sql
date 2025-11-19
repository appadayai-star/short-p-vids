-- Add parent_comment_id to comments table for threaded replies
ALTER TABLE public.comments ADD COLUMN parent_comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX idx_comments_parent_comment_id ON public.comments(parent_comment_id);

-- Add a comment to track replies count (optional but useful)
ALTER TABLE public.comments ADD COLUMN replies_count INTEGER DEFAULT 0 NOT NULL;

-- Create function to update replies count
CREATE OR REPLACE FUNCTION public.update_comment_replies_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_comment_id IS NOT NULL THEN
    UPDATE public.comments SET replies_count = replies_count + 1 WHERE id = NEW.parent_comment_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_comment_id IS NOT NULL THEN
    UPDATE public.comments SET replies_count = replies_count - 1 WHERE id = OLD.parent_comment_id;
  END IF;
  RETURN NULL;
END;
$$;

-- Create trigger for automatic replies count updates
CREATE TRIGGER trigger_update_comment_replies_count
AFTER INSERT OR DELETE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.update_comment_replies_count();