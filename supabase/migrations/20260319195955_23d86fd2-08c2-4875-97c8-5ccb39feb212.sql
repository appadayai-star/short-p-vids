CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Block any account not created through our verified backend signup flow
  IF NEW.raw_user_meta_data->>'signup_source' IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'Direct signups are disabled. Please use the app signup form.';
  END IF;

  INSERT INTO public.profiles (id, username, avatar_url, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'username', ''), 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );

  RETURN NEW;
END;
$$;