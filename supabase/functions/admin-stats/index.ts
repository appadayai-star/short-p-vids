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

    // Verify admin status
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to check admin status
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: adminRole, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !adminRole) {
      console.error("Role check error:", roleError);
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: "startDate and endDate are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Fetching stats from ${startDate} to ${endDate}`);

    // Get totals using service client for full access
    const [viewsResult, signupsResult, likesResult, savesResult, uploadsResult] = await Promise.all([
      serviceClient
        .from("video_views")
        .select("id", { count: "exact", head: true })
        .gte("viewed_at", startDate)
        .lte("viewed_at", endDate),
      serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("likes")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("saved_videos")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("videos")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startDate)
        .lte("created_at", endDate),
    ]);

    // Fetch daily breakdown data
    const [viewsDaily, signupsDaily, likesDaily, savesDaily, uploadsDaily] = await Promise.all([
      serviceClient
        .from("video_views")
        .select("viewed_at")
        .gte("viewed_at", startDate)
        .lte("viewed_at", endDate),
      serviceClient
        .from("profiles")
        .select("created_at")
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("likes")
        .select("created_at")
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("saved_videos")
        .select("created_at")
        .gte("created_at", startDate)
        .lte("created_at", endDate),
      serviceClient
        .from("videos")
        .select("created_at")
        .gte("created_at", startDate)
        .lte("created_at", endDate),
    ]);

    // Group by date helper
    const groupByDate = (items: { created_at?: string; viewed_at?: string }[] | null, dateField: string) => {
      const counts: Record<string, number> = {};
      if (!items) return counts;
      for (const item of items) {
        const dateStr = (item as Record<string, string>)[dateField];
        if (dateStr) {
          const date = dateStr.split("T")[0];
          counts[date] = (counts[date] || 0) + 1;
        }
      }
      return counts;
    };

    const viewsByDate = groupByDate(viewsDaily.data, "viewed_at");
    const signupsByDate = groupByDate(signupsDaily.data, "created_at");
    const likesByDate = groupByDate(likesDaily.data, "created_at");
    const savesByDate = groupByDate(savesDaily.data, "created_at");
    const uploadsByDate = groupByDate(uploadsDaily.data, "created_at");

    // Build daily array
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daily: { date: string; views: number; signups: number; likes: number; saves: number; uploads: number }[] = [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      daily.push({
        date: dateStr,
        views: viewsByDate[dateStr] || 0,
        signups: signupsByDate[dateStr] || 0,
        likes: likesByDate[dateStr] || 0,
        saves: savesByDate[dateStr] || 0,
        uploads: uploadsByDate[dateStr] || 0,
      });
    }

    const stats = {
      views: viewsResult.count || 0,
      signups: signupsResult.count || 0,
      likes: likesResult.count || 0,
      saves: savesResult.count || 0,
      uploads: uploadsResult.count || 0,
      daily,
    };

    console.log("Stats:", { ...stats, daily: `${daily.length} days` });

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
