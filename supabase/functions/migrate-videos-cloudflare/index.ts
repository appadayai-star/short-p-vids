import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5; // Process 5 at a time to avoid rate limits
const DELAY_BETWEEN_UPLOADS_MS = 2000; // 2 second delay between uploads

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const CLOUDFLARE_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
    const CLOUDFLARE_API_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
      throw new Error("Cloudflare credentials not configured");
    }

    // Verify admin authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userSupabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userError } = await userSupabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse optional limit from request body
    let limit = BATCH_SIZE;
    try {
      const body = await req.json();
      if (body?.limit) limit = Math.min(body.limit, 20); // Max 20 per invocation
    } catch {
      // No body or invalid JSON is fine
    }

    // Get videos that don't have cloudflare_video_id yet
    // Prefer videos that have a cloudinary URL (already optimized) or original URL
    const { data: videos, error: videosError } = await supabase
      .from("videos")
      .select("id, video_url, optimized_video_url, cloudinary_public_id")
      .is("cloudflare_video_id", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (videosError) throw videosError;

    // Get total counts for status
    const { count: totalCount } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true });

    const { count: migratedCount } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .not("cloudflare_video_id", "is", null);

    console.log(`Found ${videos?.length || 0} videos to migrate. Total: ${totalCount}, Already migrated: ${migratedCount}`);

    const results: { id: string; status: string; cloudflareVideoId?: string; error?: string }[] = [];

    for (const video of videos || []) {
      try {
        console.log(`Migrating video: ${video.id}`);

        // Determine best source URL for migration
        // Prefer optimized URL, then original
        const sourceUrl = video.optimized_video_url || video.video_url;

        // Upload to Cloudflare Stream via URL copy
        const cfResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/copy`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: sourceUrl,
              meta: { name: video.id },
            }),
          }
        );

        const cfResult = await cfResponse.json();

        if (!cfResult.success) {
          throw new Error(cfResult.errors?.[0]?.message || "Cloudflare upload failed");
        }

        const cloudflareVideoId = cfResult.result.uid;

        // Update database immediately (don't wait for processing)
        await supabase
          .from("videos")
          .update({ cloudflare_video_id: cloudflareVideoId })
          .eq("id", video.id);

        results.push({ id: video.id, status: "migrated", cloudflareVideoId });
        console.log(`Video ${video.id} migrated to Cloudflare: ${cloudflareVideoId}`);

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_UPLOADS_MS));

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error migrating video ${video.id}:`, errorMsg);
        results.push({ id: video.id, status: "failed", error: errorMsg });
      }
    }

    const { count: remainingCount } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .is("cloudflare_video_id", null);

    return new Response(
      JSON.stringify({
        success: true,
        total: totalCount || 0,
        migrated: (migratedCount || 0) + results.filter(r => r.status === "migrated").length,
        failed: results.filter(r => r.status === "failed").length,
        remaining: remainingCount || 0,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Migration error:", errorMessage);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
