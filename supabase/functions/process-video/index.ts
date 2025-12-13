import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
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

    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a client with the user's JWT to verify their identity
    const userSupabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      console.error("Auth error:", userError);
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

    // Initialize Supabase admin client for database operations
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Verify the user owns the video
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("user_id")
      .eq("id", videoId)
      .single();

    if (videoError || !video) {
      console.error("Video not found:", videoError);
      return new Response(
        JSON.stringify({ error: "Video not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (video.user_id !== user.id) {
      console.error(`User ${user.id} attempted to process video owned by ${video.user_id}`);
      return new Response(
        JSON.stringify({ error: "Forbidden: You do not own this video" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Original URL: ${videoUrl}`);

    // Update status to processing
    await supabase
      .from("videos")
      .update({ processing_status: "processing" })
      .eq("id", videoId);

    // Generate Cloudinary signature for upload
    const timestamp = Math.floor(Date.now() / 1000);
    
    // CANONICAL TRANSFORMATION - used for both eager generation AND playback URL
    // This ensures CDN cache hits since upload and playback use identical transforms
    const CANONICAL_TRANSFORM = "f_mp4,vc_h264,ac_aac,c_limit,h_720,fps_30,br_1200k,q_auto:eco,fl_faststart";
    
    // Eager transformations - generate the canonical MP4 synchronously (not async)
    // so it's ready immediately after upload
    const eagerTransforms = CANONICAL_TRANSFORM;
    
    // Create signature for authenticated upload
    // NOTE: eager_async=false so we wait for transform to complete
    const signatureString = `eager=${eagerTransforms}&folder=optimized&public_id=${videoId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    
    // Hash the signature using crypto
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    console.log("Uploading to Cloudinary with canonical transform:", CANONICAL_TRANSFORM);

    // Upload video to Cloudinary with transformations
    const formData = new FormData();
    formData.append("file", videoUrl);
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);
    formData.append("public_id", videoId);
    formData.append("folder", "optimized");
    formData.append("resource_type", "video");
    formData.append("eager", eagerTransforms);
    // NOT async - wait for transform to complete so URL is immediately usable
    // formData.append("eager_async", "true");

    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const cloudinaryResult = await cloudinaryResponse.json();

    if (cloudinaryResult.error) {
      console.error("Cloudinary error:", cloudinaryResult.error);
      throw new Error(cloudinaryResult.error.message);
    }

    console.log("Cloudinary upload successful:", cloudinaryResult.secure_url);
    console.log("Original size:", cloudinaryResult.bytes, "bytes");
    console.log("Public ID:", cloudinaryResult.public_id);

    // Extract the eager transformation result URL (the pre-generated MP4)
    const publicId = cloudinaryResult.public_id;
    let optimizedVideoUrl: string | null = null;
    
    // Get the eager transform result - this is the canonical URL we'll use for playback
    if (cloudinaryResult.eager && cloudinaryResult.eager.length > 0) {
      optimizedVideoUrl = cloudinaryResult.eager[0].secure_url;
      console.log("Eager transform URL (canonical):", optimizedVideoUrl);
    } else {
      // Fallback: construct the canonical URL manually
      optimizedVideoUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${CANONICAL_TRANSFORM}/${publicId}.mp4`;
      console.log("Constructed canonical URL:", optimizedVideoUrl);
    }

    // Generate thumbnail URL with deterministic transform
    const thumbnailUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_480,h_852,c_fill,g_auto,f_jpg,q_auto,so_0/${publicId}.jpg`;
    console.log("Thumbnail URL:", thumbnailUrl);

    // Update the video record with BOTH public_id AND the canonical optimized URL
    const { error: updateError } = await supabase
      .from("videos")
      .update({
        cloudinary_public_id: publicId,
        optimized_video_url: optimizedVideoUrl, // Store the exact URL for playback
        thumbnail_url: thumbnailUrl,
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
        cloudinaryPublicId: publicId,
        originalSize: cloudinaryResult.bytes,
        duration: cloudinaryResult.duration,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error processing video:", errorMessage);
    
    // Try to update status to failed if we have videoId
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
