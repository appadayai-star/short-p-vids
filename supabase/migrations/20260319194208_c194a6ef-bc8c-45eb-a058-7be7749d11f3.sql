-- Update handle_new_user to only create profiles for users created through our edge function.
-- Our edge function sets a special metadata flag 'signup_source' = 'edge_function'.
-- Direct Auth API signups won't have this flag and will get a generic username, 
-- which we can then use to identify and block them.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only create profile if signup came through our edge function
  -- Our edge function sets signup_source = 'verified' in user_metadata
  IF NEW.raw_user_meta_data->>'signup_source' != 'verified' THEN
    -- Still create profile but mark it for review/deletion
    -- This prevents errors but flags unauthorized signups
    INSERT INTO public.profiles (id, username, avatar_url, email)
    VALUES (
      NEW.id,
      'BLOCKED_' || substr(NEW.id::text, 1, 8),
      NULL,
      NEW.email
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, username, avatar_url, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );
  RETURN NEW;
END;
$$;