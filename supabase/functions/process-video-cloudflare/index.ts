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

    // Verify user authentication
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

    const { videoUrl, videoId } = await req.json();
    if (!videoUrl || !videoId) {
      throw new Error("Missing videoUrl or videoId");
    }

    console.log(`Processing video: ${videoId} for user: ${user.id}`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Verify user owns the video
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("user_id")
      .eq("id", videoId)
      .single();

    if (videoError || !video) {
      return new Response(
        JSON.stringify({ error: "Video not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (video.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden: You do not own this video" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to processing
    await supabase
      .from("videos")
      .update({ processing_status: "processing" })
      .eq("id", videoId);

    console.log(`Uploading to Cloudflare Stream via URL: ${videoUrl}`);

    // Upload to Cloudflare Stream using URL-to-copy method
    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/copy`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: videoUrl,
          meta: {
            name: videoId,
          },
        }),
      }
    );

    const cfResult = await cfResponse.json();

    if (!cfResult.success) {
      console.error("Cloudflare Stream error:", cfResult.errors);
      throw new Error(cfResult.errors?.[0]?.message || "Cloudflare Stream upload failed");
    }

    const cloudflareVideoId = cfResult.result.uid;
    console.log(`Cloudflare Stream upload initiated. Video ID: ${cloudflareVideoId}`);

    // Poll Cloudflare for processing completion (up to 2 minutes)
    let isReady = false;
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${cloudflareVideoId}`,
        {
          headers: { "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}` },
        }
      );

      const statusResult = await statusResponse.json();
      if (statusResult.success && statusResult.result) {
        const status = statusResult.result.status;
        console.log(`Cloudflare processing status: ${JSON.stringify(status)}`);

        if (status?.state === "ready") {
          isReady = true;

          // Check duration - reject if under 10 seconds
          const duration = statusResult.result.duration;
          if (duration && duration < 10) {
            console.error(`Video too short: ${duration}s (minimum 10s)`);

            // Delete from Cloudflare
            await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${cloudflareVideoId}`,
              {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}` },
              }
            ).catch(() => {});

            // Delete video record
            await supabase.from("videos").delete().eq("id", videoId);

            return new Response(
              JSON.stringify({ error: "Video must be at least 10 seconds long" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          break;
        }

        if (status?.state === "error") {
          throw new Error(`Cloudflare processing failed: ${status.errorReasonText || "Unknown error"}`);
        }
      }
    }

    // Only save cloudflare_video_id once the video is fully ready to stream
    if (!isReady) {
      console.error("Cloudflare processing did not complete within timeout");
      
      // Clean up the Cloudflare video since it's not ready
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${cloudflareVideoId}`,
        {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}` },
        }
      ).catch(() => {});

      await supabase
        .from("videos")
        .update({ processing_status: "failed", processing_error: "Cloudflare processing timed out" })
        .eq("id", videoId);

      return new Response(
        JSON.stringify({ error: "Video processing timed out. Please try again." }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabase
      .from("videos")
      .update({
        cloudflare_video_id: cloudflareVideoId,
        processing_status: "completed",
      })
      .eq("id", videoId);

    if (updateError) {
      console.error("Error updating video record:", updateError);
      throw updateError;
    }

    console.log("Video processing completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        cloudflareVideoId,
        ready: isReady,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing video:", errorMessage);

    try {
      const { videoId } = await req.clone().json().catch(() => ({}));
      if (videoId) {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
        await supabase
          .from("videos")
          .update({ processing_status: "failed" })
          .eq("id", videoId);
      }
    } catch (e) {
      console.error("Failed to update error status:", e);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
