import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/xml",
};

const BASE_URL = "https://shortpornvids.com";

// Categories for the platform
const CATEGORIES = ["Beauty", "Real", "Public", "Homemade", "POV", "Mom"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all videos
    const { data: videos, error: videosError } = await supabase
      .from("videos")
      .select("id, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (videosError) {
      console.error("Error fetching videos:", videosError);
    }

    // Fetch all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("username, created_at")
      .order("created_at", { ascending: false });

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
    }

    const now = new Date().toISOString().split("T")[0];

    // Build sitemap XML
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  
  <!-- Homepage -->
  <url>
    <loc>${BASE_URL}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- Feed Page -->
  <url>
    <loc>${BASE_URL}/feed</loc>
    <lastmod>${now}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>
  
  <!-- Categories Page -->
  <url>
    <loc>${BASE_URL}/categories</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  
  <!-- Search Page -->
  <url>
    <loc>${BASE_URL}/search</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  
  <!-- Auth Page -->
  <url>
    <loc>${BASE_URL}/auth</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
`;

    // Add category pages
    for (const category of CATEGORIES) {
      sitemap += `
  <!-- Category: ${category} -->
  <url>
    <loc>${BASE_URL}/feed?category=${encodeURIComponent(category)}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
    }

    // Add video pages
    if (videos && videos.length > 0) {
      for (const video of videos) {
        const lastmod = video.updated_at 
          ? new Date(video.updated_at).toISOString().split("T")[0]
          : new Date(video.created_at).toISOString().split("T")[0];
        
        sitemap += `
  
  <!-- Video -->
  <url>
    <loc>${BASE_URL}/video/${video.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      }
    }

    // Add profile pages
    if (profiles && profiles.length > 0) {
      for (const profile of profiles) {
        const lastmod = new Date(profile.created_at).toISOString().split("T")[0];
        
        sitemap += `
  
  <!-- Profile -->
  <url>
    <loc>${BASE_URL}/profile/${encodeURIComponent(profile.username)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      }
    }

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Sitemap generation error:", error);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`,
      { headers: corsHeaders }
    );
  }
});
