
CREATE TABLE public.tracking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.tracking_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  clicked_at timestamp with time zone NOT NULL DEFAULT now(),
  referrer text,
  user_agent text
);

ALTER TABLE public.tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage tracking links" ON public.tracking_links
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can read active tracking links" ON public.tracking_links
  FOR SELECT TO public
  USING (is_active = true);

CREATE POLICY "Anyone can insert tracking clicks" ON public.tracking_clicks
  FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Admins can view tracking clicks" ON public.tracking_clicks
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
