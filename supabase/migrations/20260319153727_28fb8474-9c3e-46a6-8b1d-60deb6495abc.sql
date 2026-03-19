
-- Ads table for managing livestream-style ads
CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  video_url text NOT NULL,
  thumbnail_url text,
  external_link text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

-- Ad impressions (views)
CREATE TABLE public.ad_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid REFERENCES public.ads(id) ON DELETE CASCADE NOT NULL,
  viewer_id text,
  session_id text,
  user_id uuid,
  viewed_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Ad clicks
CREATE TABLE public.ad_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid REFERENCES public.ads(id) ON DELETE CASCADE NOT NULL,
  viewer_id text,
  session_id text,
  user_id uuid,
  clicked_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS on ads: viewable by everyone, manageable by admins
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_clicks ENABLE ROW LEVEL SECURITY;

-- Ads: everyone can read active ads
CREATE POLICY "Active ads are viewable by everyone" ON public.ads
  FOR SELECT TO public USING (true);

-- Ads: admins can manage
CREATE POLICY "Admins can manage ads" ON public.ads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ad views: anyone can insert, admins can read
CREATE POLICY "Anyone can insert ad views" ON public.ad_views
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Admins can view ad views" ON public.ad_views
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Ad clicks: anyone can insert, admins can read
CREATE POLICY "Anyone can insert ad clicks" ON public.ad_clicks
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Admins can view ad clicks" ON public.ad_clicks
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
