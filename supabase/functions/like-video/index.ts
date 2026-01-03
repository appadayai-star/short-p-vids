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

    // Check if this is a valid UUID (authenticated user) vs guest client
    const isAuthenticatedUser = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) && !clientId.startsWith('guest_');

    if (action === "like") {
      if (isAuthenticatedUser) {
        // For authenticated users, insert into likes table (trigger updates count)
        const { error: insertError } = await supabase
          .from("likes")
          .insert({ video_id: videoId, user_id: clientId });
        
        if (insertError && !insertError.message.includes('duplicate')) {
          console.error("Error inserting like:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to save like" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // For guest users, insert into guest_likes table AND increment count
        const { error: insertError } = await supabase
          .from("guest_likes")
          .insert({ guest_id: clientId, video_id: videoId });
        
        if (insertError && !insertError.message.includes('duplicate')) {
          console.error("Error inserting guest like:", insertError);
        }
        
        // Also increment the likes_count on videos table
        const { error: incrementError } = await supabase.rpc('increment_likes_count', { 
          video_id_param: videoId 
        });
        
        if (incrementError) {
          console.error("Error incrementing likes count:", incrementError);
        }
      }
    } else if (action === "unlike") {
      if (isAuthenticatedUser) {
        // For authenticated users, delete from likes table (trigger updates count)
        const { error: deleteError } = await supabase
          .from("likes")
          .delete()
          .eq("video_id", videoId)
          .eq("user_id", clientId);
        
        if (deleteError) {
          console.error("Error deleting like:", deleteError);
        }
      } else {
        // For guest users, delete from guest_likes table AND decrement count
        const { error: deleteError } = await supabase
          .from("guest_likes")
          .delete()
          .eq("guest_id", clientId)
          .eq("video_id", videoId);
        
        if (deleteError) {
          console.error("Error deleting guest like:", deleteError);
        }
        
        // Also decrement the likes_count on videos table
        const { error: decrementError } = await supabase.rpc('decrement_likes_count', { 
          video_id_param: videoId 
        });
        
        if (decrementError) {
          console.error("Error decrementing likes count:", decrementError);
        }
      }
    }

    // Get the updated likes count from the database (triggers handle the count)
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

    const newCount = video.likes_count || 0;
    console.log(`Video ${videoId} ${action}d by client ${clientId}. Current count: ${newCount}`);

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
