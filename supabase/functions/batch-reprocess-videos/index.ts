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
    const CLOUDINARY_CLOUD_NAME = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const CLOUDINARY_API_KEY = Deno.env.get("CLOUDINARY_API_KEY");
    const CLOUDINARY_API_SECRET = Deno.env.get("CLOUDINARY_API_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new Error("Cloudinary credentials not configured");
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

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
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

    // Get all videos without cloudinary_public_id
    const { data: videos, error: videosError } = await supabase
      .from("videos")
      .select("id, video_url")
      .is("cloudinary_public_id", null)
      .order("created_at", { ascending: true });

    if (videosError) {
      throw videosError;
    }

    console.log(`Found ${videos?.length || 0} videos to reprocess`);

    const results: { id: string; status: string; error?: string }[] = [];

    for (const video of videos || []) {
      try {
        console.log(`Processing video: ${video.id}`);

        // Update status to processing
        await supabase
          .from("videos")
          .update({ processing_status: "processing" })
          .eq("id", video.id);

        // CANONICAL TRANSFORMATION - same as process-video for consistency
        const CANONICAL_TRANSFORM = "f_mp4,vc_h264,ac_aac,c_limit,h_720,fps_30,br_1200k,q_auto:eco,fl_faststart";
        
        // Generate Cloudinary signature - NOT async so transform completes before we continue
        const timestamp = Math.floor(Date.now() / 1000);
        const signatureString = `eager=${CANONICAL_TRANSFORM}&folder=optimized&public_id=${video.id}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
        
        const encoder = new TextEncoder();
        const data = encoder.encode(signatureString);
        const hashBuffer = await crypto.subtle.digest("SHA-1", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

        // Upload to Cloudinary with synchronous eager transform
        const formData = new FormData();
        formData.append("file", video.video_url);
        formData.append("api_key", CLOUDINARY_API_KEY);
        formData.append("timestamp", timestamp.toString());
        formData.append("signature", signature);
        formData.append("public_id", video.id);
        formData.append("folder", "optimized");
        formData.append("resource_type", "video");
        formData.append("eager", CANONICAL_TRANSFORM);
        // NOT async - wait for transform to complete

        const cloudinaryResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
          { method: "POST", body: formData }
        );

        const cloudinaryResult = await cloudinaryResponse.json();

        if (cloudinaryResult.error) {
          throw new Error(cloudinaryResult.error.message);
        }

        const publicId = cloudinaryResult.public_id;
        
        // Extract the eager transformation result URL (the pre-generated MP4)
        let optimizedVideoUrl: string | null = null;
        if (cloudinaryResult.eager && cloudinaryResult.eager.length > 0) {
          optimizedVideoUrl = cloudinaryResult.eager[0].secure_url;
        } else {
          // Fallback: construct the canonical URL manually
          optimizedVideoUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${CANONICAL_TRANSFORM}/${publicId}.mp4`;
        }
        
        // Generate thumbnail URL
        const thumbnailUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;

        // Update video with cloudinary_public_id AND optimized_video_url
        await supabase
          .from("videos")
          .update({
            cloudinary_public_id: publicId,
            optimized_video_url: optimizedVideoUrl,
            thumbnail_url: thumbnailUrl,
            processing_status: "completed",
          })
          .eq("id", video.id);

        results.push({ id: video.id, status: "completed" });
        console.log(`Video ${video.id} processed successfully`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error processing video ${video.id}:`, errorMsg);
        
        await supabase
          .from("videos")
          .update({ processing_status: "failed" })
          .eq("id", video.id);

        results.push({ id: video.id, status: "failed", error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: videos?.length || 0,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Batch reprocess error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
