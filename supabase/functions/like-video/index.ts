import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory rate limiting (per function instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // Max 30 likes per minute per client

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  
  entry.count++;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { videoId, clientId, action } = await req.json();

    if (!videoId || !clientId) {
      return new Response(
        JSON.stringify({ error: "Missing videoId or clientId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action !== "like" && action !== "unlike") {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'like' or 'unlike'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting check
    const rateLimitKey = `${clientId}:${videoId}`;
    if (isRateLimited(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: "Rate limited. Please wait before trying again." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get current likes count
    const { data: video, error: fetchError } = await supabase
      .from("videos")
      .select("likes_count")
      .eq("id", videoId)
      .single();

    if (fetchError || !video) {
      console.error("Error fetching video:", fetchError);
      return new Response(
        JSON.stringify({ error: "Video not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate new count
    const currentCount = video.likes_count || 0;
    const newCount = action === "like" 
      ? currentCount + 1 
      : Math.max(0, currentCount - 1);

    // Update the likes count
    const { error: updateError } = await supabase
      .from("videos")
      .update({ likes_count: newCount })
      .eq("id", videoId);

    if (updateError) {
      console.error("Error updating likes count:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update like" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Video ${videoId} ${action}d by client ${clientId}. New count: ${newCount}`);

    return new Response(
      JSON.stringify({ success: true, likesCount: newCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in like-video function:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
