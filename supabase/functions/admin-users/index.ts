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
    const roleFilter = url.searchParams.get("role");

    console.log(`Fetching users: search="${search}", page=${page}, limit=${limit}, role=${roleFilter}`);

    // Get all auth users (we need to handle pagination properly)
    const { data: authUsers, error: authUsersError } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: limit,
    });

    if (authUsersError) {
      console.error("Error fetching auth users:", authUsersError);
      throw authUsersError;
    }

    // Get profiles
    const { data: profiles, error: profilesError } = await serviceClient
      .from("profiles")
      .select("id, username, avatar_url, created_at");

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      throw profilesError;
    }

    // Get user roles
    const { data: userRoles } = await serviceClient
      .from("user_roles")
      .select("user_id, role");

    // Get video counts per user
    const { data: videoCounts } = await serviceClient
      .from("videos")
      .select("user_id");

    const videoCountMap = new Map<string, number>();
    videoCounts?.forEach((v) => {
      videoCountMap.set(v.user_id, (videoCountMap.get(v.user_id) || 0) + 1);
    });

    // Get likes counts per user (likes they have made)
    const { data: likeCounts } = await serviceClient
      .from("likes")
      .select("user_id");

    const likeCountMap = new Map<string, number>();
    likeCounts?.forEach((l) => {
      likeCountMap.set(l.user_id, (likeCountMap.get(l.user_id) || 0) + 1);
    });

    // Create role map
    const roleMap = new Map<string, string>();
    userRoles?.forEach((r) => {
      roleMap.set(r.user_id, r.role);
    });

    // Merge data
    let users = authUsers.users.map((authUser) => {
      const profile = profiles?.find((p) => p.id === authUser.id);
      const role = roleMap.get(authUser.id) || "user";
      return {
        id: authUser.id,
        email: authUser.email,
        username: profile?.username || `user_${authUser.id.slice(0, 8)}`,
        avatar_url: profile?.avatar_url,
        created_at: authUser.created_at,
        video_count: videoCountMap.get(authUser.id) || 0,
        likes_made: likeCountMap.get(authUser.id) || 0,
        role,
      };
    });

    // Filter by search (email or username)
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.email?.toLowerCase().includes(searchLower) ||
          u.username?.toLowerCase().includes(searchLower)
      );
    }

    // Filter by role if specified
    if (roleFilter) {
      users = users.filter((u) => u.role === roleFilter);
    }

    console.log(`Returning ${users.length} users, total from auth: ${authUsers.total || authUsers.users.length}`);

    return new Response(
      JSON.stringify({
        users,
        total: authUsers.total || authUsers.users.length,
        page,
        limit,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching users:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
