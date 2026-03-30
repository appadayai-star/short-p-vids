import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_NAME = "ShortPornVids";
const BASE_URL = "https://shortpornvids.com";
const CLOUDFLARE_SUBDOMAIN = "customer-qb7mect5e41byr1i";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const videoUrl = url.searchParams.get("url");
    const format = url.searchParams.get("format") || "json";

    if (format !== "json") {
      return new Response(JSON.stringify({ error: "Only JSON format supported" }), {
        status: 501,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract video ID from URL
    const match = videoUrl.match(/\/video\/([a-f0-9-]+)/i);
    if (!match) {
      return new Response(JSON.stringify({ error: "Invalid video URL" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const videoId = match[1];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: video, error } = await supabase
      .from("videos")
      .select("id, title, description, thumbnail_url, cloudflare_video_id")
      .eq("id", videoId)
      .single();

    if (error || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const thumbnailUrl = video.cloudflare_video_id
      ? `https://${CLOUDFLARE_SUBDOMAIN}.cloudflarestream.com/${video.cloudflare_video_id}/thumbnails/thumbnail.jpg?time=0s&height=630&width=1200`
      : video.thumbnail_url || `${BASE_URL}/og-image.jpg`;

    const oembedResponse = {
      version: "1.0",
      type: "video",
      provider_name: SITE_NAME,
      provider_url: BASE_URL,
      title: video.title,
      thumbnail_url: thumbnailUrl,
      thumbnail_width: 1200,
      thumbnail_height: 630,
      html: `<iframe src="${BASE_URL}/embed/video/${video.id}" width="480" height="852" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>`,
      width: 480,
      height: 852,
    };

    return new Response(JSON.stringify(oembedResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("oEmbed error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
