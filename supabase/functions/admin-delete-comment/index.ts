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

    const { commentId } = await req.json();

    if (!commentId) {
      return new Response(JSON.stringify({ error: "commentId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Admin deleting comment: ${commentId}`);

    // Get comment to update video comments_count
    const { data: comment } = await serviceClient
      .from("comments")
      .select("video_id, parent_comment_id")
      .eq("id", commentId)
      .single();

    // Delete comment likes
    await serviceClient.from("comment_likes").delete().eq("comment_id", commentId);

    // Delete replies to this comment
    const { data: replies } = await serviceClient
      .from("comments")
      .select("id")
      .eq("parent_comment_id", commentId);

    if (replies && replies.length > 0) {
      const replyIds = replies.map(r => r.id);
      await serviceClient.from("comment_likes").delete().in("comment_id", replyIds);
      await serviceClient.from("comments").delete().in("id", replyIds);
    }

    // Delete notifications related to this comment
    await serviceClient.from("notifications").delete().eq("comment_id", commentId);

    // Delete the comment
    const { error: deleteError } = await serviceClient
      .from("comments")
      .delete()
      .eq("id", commentId);

    if (deleteError) {
      console.error("Error deleting comment:", deleteError);
      throw deleteError;
    }

    console.log(`Successfully deleted comment: ${commentId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting comment:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
