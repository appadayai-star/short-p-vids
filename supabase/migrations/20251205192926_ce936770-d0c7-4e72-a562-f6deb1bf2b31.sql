-- Drop the existing SECURITY DEFINER view and recreate with SECURITY INVOKER
DROP VIEW IF EXISTS public.profiles_public;

-- Recreate the view with SECURITY INVOKER (the default and safer option)
CREATE VIEW public.profiles_public 
WITH (security_invoker = true)
AS SELECT 
  id,
  username,
  avatar_url,
  bio,
  followers_count,
  following_count,
  created_at,
  CASE 
    WHEN auth.uid() = id THEN email
    ELSE NULL
  END as email
FROM public.profiles;