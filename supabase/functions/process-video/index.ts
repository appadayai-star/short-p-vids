import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to update video status in database
async function updateVideoStatus(
  supabase: ReturnType<typeof createClient>,
  videoId: string,
  status: "processing" | "completed" | "failed",
  data?: {
    cloudinary_public_id?: string | null;
    optimized_video_url?: string | null;
    thumbnail_url?: string | null;
    processing_error?: string | null;
  }
) {
  // Build update payload
  const updatePayload: Record<string, unknown> = {
    processing_status: status,
    cloudinary_public_id: data?.cloudinary_public_id,
    optimized_video_url: data?.optimized_video_url,
    thumbnail_url: data?.thumbnail_url,
    thumbnail_generated: status === "completed",
    processing_error: data?.processing_error,
  };

  // On failure, clear cloudinary fields to prevent frontend from using invalid URLs
  if (status === "failed") {
    updatePayload.cloudinary_public_id = null;
    updatePayload.optimized_video_url = null;
  }

  // Use any to bypass strict typing for Supabase client
  const { error } = await (supabase as any)
    .from("videos")
    .update(updatePayload)
    .eq("id", videoId);

  if (error) {
    console.error(`Failed to update video ${videoId} status to ${status}:`, error);
  } else {
    console.log(`Video ${videoId} status updated to ${status}`);
  }
}

// Verify the asset exists on Cloudinary by checking the delivery URL
async function verifyCloudinaryAsset(
  cloudName: string,
  publicId: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    // Build the delivery URL for the raw uploaded video
    const deliveryUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${publicId}`;
    
    console.log(`Verifying Cloudinary asset at: ${deliveryUrl}`);
    
    const response = await fetch(deliveryUrl, { method: "HEAD" });
    
    if (response.ok) {
      console.log(`Cloudinary asset verified: ${publicId}`);
      return { exists: true };
    } else {
      console.error(`Cloudinary asset not found: ${response.status} ${response.statusText}`);
      return { exists: false, error: `Asset not found: HTTP ${response.status}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to verify Cloudinary asset: ${errorMessage}`);
    return { exists: false, error: errorMessage };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let videoId: string | undefined;
  let supabase: ReturnType<typeof createClient> | undefined;

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

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    // Parse request body
    const body = await req.json();
    videoId = body.videoId;
    const videoUrl = body.videoUrl;

    if (!videoUrl || !videoId) {
      throw new Error("Missing videoUrl or videoId");
    }

    console.log(`=== Processing video: ${videoId} ===`);
    console.log(`Source URL: ${videoUrl}`);

    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user client to verify identity
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY!, {
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

    // Initialize admin client for database operations
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the user owns the video
    const { data: video, error: videoError } = await (supabase as any)
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

    const videoUserId = video.user_id as string;
    if (videoUserId !== user.id) {
      console.error(`User ${user.id} attempted to process video owned by ${videoUserId}`);
      return new Response(
        JSON.stringify({ error: "Forbidden: You do not own this video" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as processing
    await updateVideoStatus(supabase, videoId, "processing", {
      processing_error: null,
    });

    // ============================================================
    // STEP 1: Fetch actual video bytes from Supabase Storage
    // ============================================================
    console.log("Step 1: Fetching video bytes from Supabase Storage...");
    
    let videoBlob: Blob;
    try {
      const fetchResponse = await fetch(videoUrl, {
        headers: {
          // Use service role key for authenticated access if needed
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });

      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch video: HTTP ${fetchResponse.status} ${fetchResponse.statusText}`);
      }

      videoBlob = await fetchResponse.blob();
      console.log(`Fetched video: ${videoBlob.size} bytes, type: ${videoBlob.type}`);

      if (videoBlob.size === 0) {
        throw new Error("Fetched video has 0 bytes");
      }
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
      console.error(`Failed to fetch video from storage: ${errorMessage}`);
      
      await updateVideoStatus(supabase, videoId, "failed", {
        processing_error: `Failed to fetch video: ${errorMessage}`,
      });

      return new Response(
        JSON.stringify({ error: `Failed to fetch video: ${errorMessage}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // STEP 2: Upload actual bytes to Cloudinary
    // ============================================================
    console.log("Step 2: Uploading video bytes to Cloudinary...");

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `optimized/${videoId}`;
    
    // Create signature for authenticated upload
    // Note: For file uploads (not URL), we don't include the file in signature
    const signatureString = `folder=optimized&public_id=${videoId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Build multipart form with actual file bytes
    const formData = new FormData();
    formData.append("file", videoBlob, `${videoId}.mp4`);
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);
    formData.append("public_id", videoId);
    formData.append("folder", "optimized");
    formData.append("resource_type", "video");

    let cloudinaryResult: Record<string, unknown>;
    try {
      const cloudinaryResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      cloudinaryResult = await cloudinaryResponse.json();

      console.log("Cloudinary response:", JSON.stringify(cloudinaryResult, null, 2));

      // Check for Cloudinary error
      if (cloudinaryResult.error) {
        const errorMsg = (cloudinaryResult.error as { message?: string })?.message || "Unknown Cloudinary error";
        throw new Error(errorMsg);
      }

      // Verify required fields are present
      if (!cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
        throw new Error(`Cloudinary response missing required fields. Got: ${Object.keys(cloudinaryResult).join(", ")}`);
      }
    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : "Unknown upload error";
      console.error(`Cloudinary upload failed: ${errorMessage}`);
      
      await updateVideoStatus(supabase, videoId, "failed", {
        processing_error: `Cloudinary upload failed: ${errorMessage}`,
      });

      return new Response(
        JSON.stringify({ error: `Cloudinary upload failed: ${errorMessage}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uploadedPublicId = cloudinaryResult.public_id as string;
    const secureUrl = cloudinaryResult.secure_url as string;

    console.log(`Cloudinary upload successful!`);
    console.log(`  public_id: ${uploadedPublicId}`);
    console.log(`  secure_url: ${secureUrl}`);
    console.log(`  size: ${cloudinaryResult.bytes} bytes`);
    console.log(`  duration: ${cloudinaryResult.duration}s`);

    // ============================================================
    // STEP 3: Verify the asset actually exists on Cloudinary
    // ============================================================
    console.log("Step 3: Verifying asset exists on Cloudinary...");

    const verification = await verifyCloudinaryAsset(CLOUDINARY_CLOUD_NAME, uploadedPublicId);
    
    if (!verification.exists) {
      console.error(`Asset verification failed: ${verification.error}`);
      
      await updateVideoStatus(supabase, videoId, "failed", {
        processing_error: `Asset verification failed: ${verification.error}`,
      });

      return new Response(
        JSON.stringify({ error: `Asset verification failed: ${verification.error}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // STEP 4: Use Cloudinary's returned secure_url directly
    // ============================================================
    // IMPORTANT: Use the secure_url returned by Cloudinary, NOT constructed URLs
    // Constructed URLs with transformations can fail with HTTP 400
    const optimizedVideoUrl = secureUrl;
    
    // Thumbnail: grab first frame as JPG - this transformation is safe
    const thumbnailUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_0,f_jpg,w_480,q_auto/${uploadedPublicId}.jpg`;
    
    console.log(`Stored optimized_video_url (Cloudinary secure_url): ${optimizedVideoUrl}`);
    console.log(`Thumbnail URL: ${thumbnailUrl}`);

    // ============================================================
    // STEP 5: Update database with success
    // ============================================================
    console.log("Step 5: Updating database with success...");

    await updateVideoStatus(supabase, videoId, "completed", {
      cloudinary_public_id: uploadedPublicId,
      optimized_video_url: optimizedVideoUrl,
      thumbnail_url: thumbnailUrl,
      processing_error: null,
    });

    console.log(`=== Video ${videoId} processing completed successfully ===`);

    return new Response(
      JSON.stringify({
        success: true,
        cloudinaryPublicId: uploadedPublicId,
        optimizedVideoUrl: optimizedVideoUrl,
        thumbnailUrl: thumbnailUrl,
        originalSize: cloudinaryResult.bytes,
        duration: cloudinaryResult.duration,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`=== Video processing failed: ${errorMessage} ===`);
    
    // Try to update status to failed
    if (videoId && supabase) {
      await updateVideoStatus(supabase, videoId, "failed", {
        processing_error: errorMessage,
      });
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
