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

    const url = new URL(req.url);
    const search = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const offset = (page - 1) * limit;

    console.log(`Fetching videos: search="${search}", page=${page}, dates=${startDate}-${endDate}`);

    // Build query
    let query = serviceClient
      .from("videos")
      .select(`
        id,
        title,
        description,
        video_url,
        thumbnail_url,
        views_count,
        likes_count,
        created_at,
        user_id,
        profiles!videos_user_id_fkey (
          id,
          username
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,id.eq.${search}`);
    }

    if (startDate) {
      query = query.gte("created_at", startDate);
    }

    if (endDate) {
      query = query.lte("created_at", endDate);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: videos, count, error } = await query;

    if (error) {
      console.error("Error fetching videos:", error);
      throw error;
    }

    // Get saved counts for all videos
    const videoIds = videos?.map((v) => v.id) || [];
    const { data: savedData } = await serviceClient
      .from("saved_videos")
      .select("video_id");

    const savedCountMap = new Map<string, number>();
    savedData?.forEach((s) => {
      savedCountMap.set(s.video_id, (savedCountMap.get(s.video_id) || 0) + 1);
    });

    // Get uploader emails from auth
    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    
    const emailMap = new Map<string, string>();
    authUsers?.users?.forEach((u) => {
      emailMap.set(u.id, u.email || "");
    });

    const videosWithEmail = videos?.map((v) => {
      const profileData = v.profiles as unknown;
      const profile = profileData as { id: string; username: string } | null;
      return {
        ...v,
        saved_count: savedCountMap.get(v.id) || 0,
        uploader_email: emailMap.get(v.user_id) || "",
        uploader_username: profile?.username || `user_${v.user_id.slice(0, 8)}`,
      };
    });

    console.log(`Returning ${videos?.length} videos out of ${count} total`);

    return new Response(
      JSON.stringify({
        videos: videosWithEmail,
        total: count || 0,
        page,
        limit,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching videos:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
