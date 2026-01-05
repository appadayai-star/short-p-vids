import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verify Cloudinary asset exists by HEADing the delivery URL
async function verifyCloudinaryAsset(cloudName: string, publicId: string): Promise<boolean> {
  try {
    const deliveryUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${publicId}`;
    const response = await fetch(deliveryUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// Process a single video - fetch bytes and upload to Cloudinary
async function processVideo(
  supabase: any,
  videoId: string,
  videoUrl: string,
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  serviceRoleKey: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`  Processing video: ${videoId}`);

  try {
    // Step 1: Fetch video bytes from Supabase Storage
    console.log(`    Fetching video from: ${videoUrl.substring(0, 80)}...`);
    const fetchResponse = await fetch(videoUrl, {
      headers: { "Authorization": `Bearer ${serviceRoleKey}` },
    });

    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch video: HTTP ${fetchResponse.status}`);
    }

    const videoBlob = await fetchResponse.blob();
    console.log(`    Fetched ${videoBlob.size} bytes`);

    if (videoBlob.size === 0) {
      throw new Error("Video has 0 bytes");
    }

    // Step 2: Upload to Cloudinary with actual file bytes
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureString = `folder=optimized&public_id=${videoId}&timestamp=${timestamp}${apiSecret}`;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    const formData = new FormData();
    formData.append("file", videoBlob, `${videoId}.mp4`);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);
    formData.append("public_id", videoId);
    formData.append("folder", "optimized");
    formData.append("resource_type", "video");

    console.log(`    Uploading to Cloudinary...`);
    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      { method: "POST", body: formData }
    );

    const cloudinaryResult = await cloudinaryResponse.json();
    
    // Enhanced logging for Cloudinary response
    console.log(`    Cloudinary response status: ${cloudinaryResponse.status}`);
    console.log(`    Cloudinary response body: ${JSON.stringify(cloudinaryResult)}`);

    if (cloudinaryResult.error) {
      const errorDetail = JSON.stringify(cloudinaryResult.error);
      throw new Error(`Cloudinary upload failed: ${errorDetail}`);
    }

    if (!cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
      throw new Error(`Cloudinary response missing required fields. Keys: ${Object.keys(cloudinaryResult).join(", ")}`);
    }

    const uploadedPublicId = cloudinaryResult.public_id as string;
    const secureUrl = cloudinaryResult.secure_url as string;
    console.log(`    Uploaded to Cloudinary: ${uploadedPublicId}`);
    console.log(`    Cloudinary secure_url: ${secureUrl}`);

    // Step 3: Verify asset exists
    console.log(`    Verifying asset exists...`);
    const exists = await verifyCloudinaryAsset(cloudName, uploadedPublicId);
    if (!exists) {
      throw new Error("Asset verification failed - not found on Cloudinary");
    }

    // Step 4: Use Cloudinary's returned secure_url directly (NOT constructed URLs)
    // Constructed URLs with transformations can fail with HTTP 400
    const optimizedVideoUrl = secureUrl;
    const thumbnailUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_0,f_jpg,w_480,q_auto/${uploadedPublicId}.jpg`;

    const { error: updateError } = await supabase
      .from("videos")
      .update({
        processing_status: "completed",
        cloudinary_public_id: uploadedPublicId,
        optimized_video_url: optimizedVideoUrl,
        thumbnail_url: thumbnailUrl,
        thumbnail_generated: true,
        processing_error: null,
      })
      .eq("id", videoId);

    if (updateError) {
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    console.log(`    ✓ Successfully processed video ${videoId}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`    ✗ Failed: ${errorMessage}`);

    // Mark as failed in database
    await supabase
      .from("videos")
      .update({
        processing_status: "failed",
        cloudinary_public_id: null,
        optimized_video_url: null,
        processing_error: errorMessage,
      })
      .eq("id", videoId);

    return { success: false, error: errorMessage };
  }
}

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

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    // Verify admin authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY!, {
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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as any;
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

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 5, 20); // Smaller limit for background processing
    const dryRun = body.dryRun ?? true;

    console.log(`=== Batch Reprocess Videos ===`);
    console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
    console.log(`Limit: ${limit}`);

    // Find videos that need reprocessing
    const { data: brokenVideos, error: queryError } = await supabase
      .from("videos")
      .select("id, video_url, cloudinary_public_id, optimized_video_url, processing_status, processing_error")
      .or("optimized_video_url.is.null,processing_status.eq.failed")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (queryError) {
      throw new Error(`Query failed: ${queryError.message}`);
    }

    const videoCount = brokenVideos?.length || 0;
    console.log(`Found ${videoCount} videos to reprocess`);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          mode: "dry_run",
          videosFound: videoCount,
          videos: brokenVideos?.map((v: any) => ({
            id: v.id,
            hasCloudinaryId: !!v.cloudinary_public_id,
            hasOptimizedUrl: !!v.optimized_video_url,
            status: v.processing_status,
            error: v.processing_error,
          })),
          message: "Set dryRun: false to actually reprocess these videos",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (videoCount === 0) {
      return new Response(
        JSON.stringify({
          mode: "live",
          message: "No videos need reprocessing",
          started: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use background task to process videos - return immediately
    const backgroundProcess = async () => {
      console.log(`Starting background processing of ${videoCount} videos`);
      
      for (const video of brokenVideos || []) {
        await processVideo(
          supabase,
          video.id,
          video.video_url,
          CLOUDINARY_CLOUD_NAME!,
          CLOUDINARY_API_KEY!,
          CLOUDINARY_API_SECRET!,
          SUPABASE_SERVICE_ROLE_KEY!
        );
        
        // Small delay between videos
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`=== Background processing complete ===`);
    };

    // Start background processing
    EdgeRuntime.waitUntil(backgroundProcess());

    // Return immediately
    return new Response(
      JSON.stringify({
        mode: "live",
        message: `Started processing ${videoCount} videos in background`,
        started: videoCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Batch reprocess failed: ${errorMessage}`);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
