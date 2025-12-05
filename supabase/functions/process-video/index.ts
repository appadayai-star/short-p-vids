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
    
    // Transformation parameters for optimized video:
    // - 720p resolution (height 720, width auto to maintain aspect ratio)
    // - H.264 codec (vc_h264)
    // - Quality auto for optimal compression
    // - Format mp4
    // - Limit framerate to 30fps
    const eagerTransforms = "c_limit,h_720,q_auto:good,vc_h264,fps_30";
    
    // Create signature for authenticated upload
    const signatureString = `eager=${eagerTransforms}&folder=optimized&public_id=${videoId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    
    // Hash the signature using crypto
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    console.log("Uploading to Cloudinary...");

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
    formData.append("eager_async", "false");

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

    // Get the optimized video URL (from eager transformation)
    let optimizedUrl = cloudinaryResult.secure_url;
    
    // If eager transformations exist, use the transformed version
    if (cloudinaryResult.eager && cloudinaryResult.eager.length > 0) {
      optimizedUrl = cloudinaryResult.eager[0].secure_url;
      console.log("Using eager transformed URL:", optimizedUrl);
    }

    // Generate thumbnail URL (first frame of the video)
    // Cloudinary automatically generates thumbnails by replacing extension with jpg
    const thumbnailUrl = cloudinaryResult.secure_url
      .replace("/video/upload/", "/video/upload/w_720,h_1280,c_fill,g_center,so_0/")
      .replace(/\.[^/.]+$/, ".jpg");

    console.log("Generated thumbnail URL:", thumbnailUrl);

    // Update the video record with optimized URLs
    const { error: updateError } = await supabase
      .from("videos")
      .update({
        optimized_video_url: optimizedUrl,
        thumbnail_url: thumbnailUrl,
        thumbnail_generated: true,
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
        optimizedUrl,
        thumbnailUrl,
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
