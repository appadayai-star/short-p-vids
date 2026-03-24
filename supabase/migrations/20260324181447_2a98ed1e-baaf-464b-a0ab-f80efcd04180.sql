
CREATE TABLE public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  results_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert search queries"
  ON public.search_queries FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Admins can view search queries"
  ON public.search_queries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_search_queries_created_at ON public.search_queries(created_at);
CREATE INDEX idx_search_queries_query ON public.search_queries(query);
