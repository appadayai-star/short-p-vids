-- Add email column to profiles for username login lookup
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Create index for faster username lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- Update handle_new_user function to also store email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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