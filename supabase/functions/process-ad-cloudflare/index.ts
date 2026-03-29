import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json().catch(() => ({}));
    const { adId } = body;

    // If adId provided, migrate single ad. Otherwise migrate all unmigrated ads.
    let adsToMigrate;
    if (adId) {
      const { data, error } = await supabase
        .from("ads")
        .select("id, video_url, cloudflare_video_id")
        .eq("id", adId)
        .is("cloudflare_video_id", null)
        .maybeSingle();
      if (error) throw error;
      adsToMigrate = data ? [data] : [];
    } else {
      const { data, error } = await supabase
        .from("ads")
        .select("id, video_url, cloudflare_video_id")
        .is("cloudflare_video_id", null);
      if (error) throw error;
      adsToMigrate = data || [];
    }

    const results: { id: string; status: string; cloudflareVideoId?: string; error?: string }[] = [];

    for (const ad of adsToMigrate) {
      try {
        console.log(`Migrating ad: ${ad.id}, source: ${ad.video_url}`);

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
              url: ad.video_url,
              meta: { name: `ad_${ad.id}` },
            }),
          }
        );

        const cfResult = await cfResponse.json();
        if (!cfResult.success) {
          throw new Error(cfResult.errors?.[0]?.message || "Cloudflare upload failed");
        }

        const cloudflareVideoId = cfResult.result.uid;
        console.log(`Upload initiated for ad ${ad.id}, CF ID: ${cloudflareVideoId}. Polling...`);

        // Poll for ready state (up to 3 minutes)
        let isReady = false;
        for (let i = 0; i < 90; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const statusResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${cloudflareVideoId}`,
            { headers: { "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}` } }
          );
          const statusResult = await statusResponse.json();
          if (statusResult.success && statusResult.result?.status) {
            const state = statusResult.result.status.state;
            if (state === "ready") { isReady = true; break; }
            if (state === "error") {
              throw new Error(`Processing failed: ${statusResult.result.status.errorReasonText || "Unknown"}`);
            }
          }
        }

        if (!isReady) {
          results.push({ id: ad.id, status: "failed", error: "Processing timed out" });
          continue;
        }

        await supabase
          .from("ads")
          .update({ cloudflare_video_id: cloudflareVideoId })
          .eq("id", ad.id);

        results.push({ id: ad.id, status: "migrated", cloudflareVideoId });
        console.log(`Ad ${ad.id} migrated: ${cloudflareVideoId}`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error migrating ad ${ad.id}:`, errorMsg);
        results.push({ id: ad.id, status: "failed", error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results, total: adsToMigrate.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Ad migration error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
