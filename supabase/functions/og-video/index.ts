import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SITE_NAME = "ShortPornVids";
const SITE_URL = "https://shortpornvids.com";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.jpg`;
const CLOUDINARY_CLOUD_NAME = "domj6omwb";

function getCloudinaryThumbnail(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_1200,h_630,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
}

function getVideoUrl(publicId: string | null, optimizedUrl: string | null, originalUrl: string): string {
  if (optimizedUrl) return optimizedUrl;
  if (publicId) return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,q_auto/${publicId}.mp4`;
  return originalUrl;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const videoId = url.searchParams.get("id");

    if (!videoId) {
      return new Response("Missing video id", { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: video, error } = await supabase
      .from("videos")
      .select("id, title, description, video_url, optimized_video_url, cloudinary_public_id, thumbnail_url, views_count, tags, created_at, profiles(username)")
      .eq("id", videoId)
      .single();

    if (error || !video) {
      // Redirect to homepage if video not found
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: SITE_URL },
      });
    }

    const title = escapeHtml(video.title);
    const description = escapeHtml(
      video.description || `Watch ${video.title} on ${SITE_NAME}`
    );
    const pageUrl = `${SITE_URL}/video/${video.id}`;

    // Thumbnail: prefer Cloudinary OG-sized, then stored thumbnail, then default
    let thumbnailUrl = DEFAULT_IMAGE;
    if (video.cloudinary_public_id) {
      thumbnailUrl = getCloudinaryThumbnail(video.cloudinary_public_id);
    } else if (video.thumbnail_url) {
      thumbnailUrl = video.thumbnail_url;
    }

    const videoSrc = getVideoUrl(
      video.cloudinary_public_id,
      video.optimized_video_url,
      video.video_url
    );

    const creator = video.profiles?.username
      ? escapeHtml(video.profiles.username)
      : SITE_NAME;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} | ${SITE_NAME}</title>

<!-- Primary Meta -->
<meta name="title" content="${title} | ${SITE_NAME}">
<meta name="description" content="${description}">

<!-- Open Graph -->
<meta property="og:type" content="video.other">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${title} | ${SITE_NAME}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${thumbnailUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="en_US">

<!-- OG Video -->
<meta property="og:video" content="${escapeHtml(videoSrc)}">
<meta property="og:video:secure_url" content="${escapeHtml(videoSrc)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="720">
<meta property="og:video:height" content="1280">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${pageUrl}">
<meta name="twitter:title" content="${title} | ${SITE_NAME}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${thumbnailUrl}">

<!-- Canonical -->
<link rel="canonical" href="${pageUrl}">

<!-- Redirect browsers (bots won't follow this) -->
<meta http-equiv="refresh" content="0;url=${pageUrl}">
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<p>By ${creator}</p>
<a href="${pageUrl}">Watch on ${SITE_NAME}</a>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error("og-video error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});
