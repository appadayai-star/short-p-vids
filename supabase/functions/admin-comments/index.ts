import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const url = new URL(req.url);
    const search = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    console.log(`Fetching comments: search="${search}", page=${page}, limit=${limit}`);

    // Build query
    let query = serviceClient
      .from("comments")
      .select(`
        id,
        content,
        likes_count,
        replies_count,
        created_at,
        user_id,
        video_id,
        parent_comment_id,
        profiles!comments_user_id_fkey (
          id,
          username
        ),
        videos!comments_video_id_fkey (
          id,
          title
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (search) {
      query = query.ilike("content", `%${search}%`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: comments, count, error } = await query;

    if (error) {
      console.error("Error fetching comments:", error);
      throw error;
    }

    // Get user emails
    const userIds = [...new Set(comments?.map((c) => c.user_id) || [])];
    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    
    const emailMap = new Map<string, string>();
    authUsers?.users?.forEach((u) => {
      emailMap.set(u.id, u.email || "");
    });

    const commentsWithDetails = comments?.map((c) => {
      const profile = c.profiles as unknown as { id: string; username: string } | null;
      const video = c.videos as unknown as { id: string; title: string } | null;
      return {
        ...c,
        user_email: emailMap.get(c.user_id) || "",
        username: profile?.username || `user_${c.user_id.slice(0, 8)}`,
        video_title: video?.title || "Untitled",
      };
    });

    console.log(`Returning ${comments?.length} comments out of ${count} total`);

    return new Response(
      JSON.stringify({
        comments: commentsWithDetails,
        total: count || 0,
        page,
        limit,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching comments:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
