import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const TrackingRedirect = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const trackAndRedirect = async () => {
      if (!slug) {
        navigate("/feed", { replace: true });
        return;
      }

      try {
        // Look up the tracking link
        const { data: link } = await supabase
          .from("tracking_links")
          .select("id")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();

        if (link) {
          // Log the click
          await supabase.from("tracking_clicks").insert({
            link_id: link.id,
            referrer: document.referrer || null,
            user_agent: navigator.userAgent || null,
          });
        }
      } catch (err) {
        console.error("Tracking error:", err);
      }

      // Always redirect to feed
      navigate("/feed", { replace: true });
    };

    trackAndRedirect();
  }, [slug, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
};

export default TrackingRedirect;
