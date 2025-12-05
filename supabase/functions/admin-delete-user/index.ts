import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept POST for delete operations (browsers don't send body with DELETE)
  if (req.method !== "POST" && req.method !== "DELETE") {
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    const { userId } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId === user.id) {
      return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Admin deleting user: ${userId}`);

    // Delete user's videos first
    const { data: userVideos } = await serviceClient
      .from("videos")
      .select("id")
      .eq("user_id", userId);

    if (userVideos && userVideos.length > 0) {
      for (const video of userVideos) {
        const { data: comments } = await serviceClient
          .from("comments")
          .select("id")
          .eq("video_id", video.id);
        
        const commentIds = comments?.map(c => c.id) || [];
        if (commentIds.length > 0) {
          await serviceClient.from("comment_likes").delete().in("comment_id", commentIds);
        }
        await serviceClient.from("comments").delete().eq("video_id", video.id);
        await serviceClient.from("likes").delete().eq("video_id", video.id);
        await serviceClient.from("video_views").delete().eq("video_id", video.id);
        await serviceClient.from("saved_videos").delete().eq("video_id", video.id);
        await serviceClient.from("notifications").delete().eq("video_id", video.id);
      }
      await serviceClient.from("videos").delete().eq("user_id", userId);
    }

    // Delete user's comments
    const { data: userComments } = await serviceClient
      .from("comments")
      .select("id")
      .eq("user_id", userId);
    
    const userCommentIds = userComments?.map(c => c.id) || [];
    if (userCommentIds.length > 0) {
      await serviceClient.from("comment_likes").delete().in("comment_id", userCommentIds);
    }
    await serviceClient.from("comments").delete().eq("user_id", userId);

    // Delete other user data
    await serviceClient.from("likes").delete().eq("user_id", userId);
    await serviceClient.from("comment_likes").delete().eq("user_id", userId);
    await serviceClient.from("saved_videos").delete().eq("user_id", userId);
    await serviceClient.from("follows").delete().eq("follower_id", userId);
    await serviceClient.from("follows").delete().eq("following_id", userId);
    await serviceClient.from("notifications").delete().eq("user_id", userId);
    await serviceClient.from("notifications").delete().eq("actor_id", userId);
    await serviceClient.from("user_category_preferences").delete().eq("user_id", userId);
    await serviceClient.from("user_roles").delete().eq("user_id", userId);
    await serviceClient.from("profiles").delete().eq("id", userId);

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("Error deleting auth user:", deleteError);
      throw deleteError;
    }

    console.log(`Successfully deleted user: ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
