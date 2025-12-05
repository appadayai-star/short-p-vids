import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "DELETE") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for admin operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin status
    const { data: adminRole } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { videoId } = await req.json();

    if (!videoId) {
      return new Response(JSON.stringify({ error: "videoId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Admin deleting video: ${videoId}`);

    // Get video details first
    const { data: video, error: videoError } = await serviceClient
      .from("videos")
      .select("video_url, optimized_video_url, thumbnail_url")
      .eq("id", videoId)
      .single();

    if (videoError || !video) {
      console.error("Video not found:", videoError);
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete from Supabase Storage
    if (video.video_url) {
      try {
        // Extract path from URL
        const url = new URL(video.video_url);
        const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/videos\/(.+)/);
        if (pathMatch) {
          const filePath = decodeURIComponent(pathMatch[1]);
          console.log(`Deleting from storage: ${filePath}`);
          await serviceClient.storage.from("videos").remove([filePath]);
        }
      } catch (e) {
        console.error("Error deleting from storage:", e);
      }
    }

    // Try to delete from Cloudinary if we have optimized URL
    if (video.optimized_video_url && video.optimized_video_url.includes("cloudinary")) {
      try {
        const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
        const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
        const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");

        if (cloudName && apiKey && apiSecret) {
          // Extract public_id from Cloudinary URL
          const urlParts = video.optimized_video_url.split("/");
          const uploadIndex = urlParts.indexOf("upload");
          if (uploadIndex !== -1) {
            const publicIdWithExt = urlParts.slice(uploadIndex + 2).join("/");
            const publicId = publicIdWithExt.replace(/\.[^.]+$/, "");
            
            console.log(`Deleting from Cloudinary: ${publicId}`);
            
            const timestamp = Math.floor(Date.now() / 1000);
            const signatureString = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
            
            // Create SHA-1 signature
            const encoder = new TextEncoder();
            const data = encoder.encode(signatureString);
            const hashBuffer = await crypto.subtle.digest("SHA-1", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

            const formData = new FormData();
            formData.append("public_id", publicId);
            formData.append("timestamp", timestamp.toString());
            formData.append("api_key", apiKey);
            formData.append("signature", signature);

            await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/destroy`, {
              method: "POST",
              body: formData,
            });
          }
        }
      } catch (e) {
        console.error("Error deleting from Cloudinary:", e);
      }
    }

    // Get comment IDs first for deleting comment_likes
    const { data: comments } = await serviceClient
      .from("comments")
      .select("id")
      .eq("video_id", videoId);
    
    const commentIds = comments?.map(c => c.id) || [];
    
    // Delete related records first (comments, likes, views, notifications)
    if (commentIds.length > 0) {
      await serviceClient.from("comment_likes").delete().in("comment_id", commentIds);
    }
    await serviceClient.from("comments").delete().eq("video_id", videoId);
    await serviceClient.from("likes").delete().eq("video_id", videoId);
    await serviceClient.from("video_views").delete().eq("video_id", videoId);
    await serviceClient.from("saved_videos").delete().eq("video_id", videoId);
    await serviceClient.from("notifications").delete().eq("video_id", videoId);

    // Delete the video record
    const { error: deleteError } = await serviceClient
      .from("videos")
      .delete()
      .eq("id", videoId);

    if (deleteError) {
      console.error("Error deleting video record:", deleteError);
      throw deleteError;
    }

    console.log(`Successfully deleted video: ${videoId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting video:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
