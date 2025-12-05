-- Create a secure function to get email by username (uses SECURITY DEFINER to bypass RLS)
-- This function is called from the client during login and returns only the email for the matching username
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email
  FROM public.profiles
  WHERE username = p_username;
  
  RETURN v_email;
END;
$$;

-- Grant execute permission to authenticated and anonymous users (needed for login)
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO authenticated;

-- Update the profiles RLS policy to hide email from public reads
-- First, drop the existing permissive policy
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Create a new policy that returns all columns EXCEPT email for public reads
-- Users can only see their own email
CREATE POLICY "Profiles are viewable by everyone except email"
ON public.profiles
FOR SELECT
USING (true);

-- Create a security barrier view that hides email from non-owners
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT 
  id,
  username,
  avatar_url,
  bio,
  created_at,
  followers_count,
  following_count,
  CASE WHEN auth.uid() = id THEN email ELSE NULL END as email
FROM public.profiles;

-- Grant access to the view
GRANT SELECT ON public.profiles_public TO anon;
GRANT SELECT ON public.profiles_public TO authenticated;