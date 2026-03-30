import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_NAME = "ShortPornVids";
const BASE_URL = "https://shortpornvids.com";
const CLOUDFLARE_SUBDOMAIN = "customer-qb7mect5e41byr1i";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const videoId = url.searchParams.get("id");

    if (!videoId) {
      return new Response("Missing id parameter", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: video, error } = await supabase
      .from("videos")
      .select("id, title, description, thumbnail_url, cloudflare_video_id, video_url, tags, created_at, views_count, user_id, profiles(username)")
      .eq("id", videoId)
      .single();

    if (error || !video) {
      return new Response("Video not found", { status: 404 });
    }

    const thumbnailUrl = video.cloudflare_video_id
      ? `https://${CLOUDFLARE_SUBDOMAIN}.cloudflarestream.com/${video.cloudflare_video_id}/thumbnails/thumbnail.jpg?time=0s&height=630&width=1200`
      : video.thumbnail_url || `${BASE_URL}/og-image.jpg`;

    const mp4Url = video.cloudflare_video_id
      ? `https://${CLOUDFLARE_SUBDOMAIN}.cloudflarestream.com/${video.cloudflare_video_id}/downloads/default.mp4`
      : video.video_url;

    const videoPageUrl = `${BASE_URL}/video/${video.id}`;
    const embedUrl = `${BASE_URL}/embed/video/${video.id}`;
    const oembedUrl = `${BASE_URL}/api/video-oembed?url=${encodeURIComponent(videoPageUrl)}&format=json`;
    const description = video.description || `Watch ${video.title} on ${SITE_NAME}`;
    const username = (video.profiles as any)?.username || SITE_NAME;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(video.title)} | ${SITE_NAME}</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="video.other" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${escapeHtml(video.title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${videoPageUrl}" />
  <meta property="og:image" content="${thumbnailUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:video" content="${mp4Url}" />
  <meta property="og:video:secure_url" content="${mp4Url}" />
  <meta property="og:video:type" content="video/mp4" />
  <meta property="og:video:width" content="480" />
  <meta property="og:video:height" content="852" />

  <!-- Twitter Player Card -->
  <meta name="twitter:card" content="player" />
  <meta name="twitter:title" content="${escapeHtml(video.title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${thumbnailUrl}" />
  <meta name="twitter:player" content="${embedUrl}" />
  <meta name="twitter:player:width" content="480" />
  <meta name="twitter:player:height" content="852" />

  <!-- oEmbed discovery -->
  <link rel="alternate" type="application/json+oembed" href="${oembedUrl}" title="${escapeHtml(video.title)}" />

  <!-- Canonical -->
  <link rel="canonical" href="${videoPageUrl}" />

  <!-- Redirect real users to the actual page -->
  <meta http-equiv="refresh" content="0;url=${videoPageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${videoPageUrl}">${escapeHtml(video.title)}</a>...</p>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("video-meta error:", err);
    return new Response("Internal server error", { status: 500 });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
