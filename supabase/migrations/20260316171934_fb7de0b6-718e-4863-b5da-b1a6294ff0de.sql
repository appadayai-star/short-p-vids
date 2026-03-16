CREATE TABLE public.category_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  user_id uuid NULL,
  session_id text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.category_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert category clicks"
  ON public.category_clicks FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Category clicks viewable by admins"
  ON public.category_clicks FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_category_clicks_category ON public.category_clicks(category);
CREATE INDEX idx_category_clicks_created_at ON public.category_clicks(created_at);