import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3, TrendingDown, Layers, Timer, RefreshCw } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";
import { subDays, subHours, format } from "date-fns";

interface AdminSessionAnalysisProps {
  datePreset: string;
  onDatePresetChange: (preset: string) => void;
}

interface SessionRow {
  session_id: string;
  video_count: number;
  total_watch: number;
  feed_sources: string[];
  ttffs: number[];
  viewed_ats: string[];
}

const DATE_PRESETS = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All Time", value: "all" },
];

const getStartDate = (preset: string): Date | null => {
  const now = new Date();
  switch (preset) {
    case "24h": return subHours(now, 24);
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    default: return null;
  }
};

// Paginated fetch to bypass 1000-row limit
const fetchAllRows = async (startDate: Date | null) => {
  const PAGE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("video_views")
      .select("session_id, watch_duration_seconds, time_to_first_frame_ms, viewed_at, feed_source")
      .not("session_id", "is", null)
      .order("viewed_at", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (startDate) {
      query = query.gte("viewed_at", startDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    allRows = allRows.concat(data || []);
    hasMore = (data?.length || 0) === PAGE;
    offset += PAGE;
    if (offset > 50000) break; // safety cap
  }

  return allRows;
};

export const AdminSessionAnalysis = ({ datePreset, onDatePresetChange }: AdminSessionAnalysisProps) => {
  const [loading, setLoading] = useState(true);
  const [rawRows, setRawRows] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = getStartDate(datePreset);
      const rows = await fetchAllRows(startDate);
      setRawRows(rows);
    } catch (err) {
      console.error("[SessionAnalysis] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Aggregate into sessions
  const sessions = useMemo(() => {
    const map = new Map<string, SessionRow>();
    for (const row of rawRows) {
      if (!row.session_id) continue;
      const existing = map.get(row.session_id);
      if (existing) {
        existing.video_count++;
        existing.total_watch += row.watch_duration_seconds || 0;
        if (row.feed_source) existing.feed_sources.push(row.feed_source);
        if (row.time_to_first_frame_ms != null) existing.ttffs.push(row.time_to_first_frame_ms);
        existing.viewed_ats.push(row.viewed_at);
      } else {
        map.set(row.session_id, {
          session_id: row.session_id,
          video_count: 1,
          total_watch: row.watch_duration_seconds || 0,
          feed_sources: row.feed_source ? [row.feed_source] : [],
          ttffs: row.time_to_first_frame_ms != null ? [row.time_to_first_frame_ms] : [],
          viewed_ats: [row.viewed_at],
        });
      }
    }
    return Array.from(map.values());
  }, [rawRows]);

  // 1. Videos per session distribution
  const distribution = useMemo(() => {
    const buckets = { "1": 0, "2-3": 0, "4-10": 0, "11-20": 0, "20+": 0 };
    for (const s of sessions) {
      if (s.video_count === 1) buckets["1"]++;
      else if (s.video_count <= 3) buckets["2-3"]++;
      else if (s.video_count <= 10) buckets["4-10"]++;
      else if (s.video_count <= 20) buckets["11-20"]++;
      else buckets["20+"]++;
    }
    const total = sessions.length || 1;
    return Object.entries(buckets).map(([range, count]) => ({
      range,
      count,
      percent: Math.round((count / total) * 100),
    }));
  }, [sessions]);

  // 2. Drop-off curve: % still watching at video N
  const dropoffCurve = useMemo(() => {
    const total = sessions.length;
    if (total === 0) return [];
    const maxN = 20;
    const curve = [];
    for (let n = 1; n <= maxN; n++) {
      const still = sessions.filter(s => s.video_count >= n).length;
      curve.push({ videoNumber: n, percentStill: Math.round((still / total) * 100) });
    }
    return curve;
  }, [sessions]);

  // 3. Feed source performance
  const feedSourceStats = useMemo(() => {
    const sourceMap = new Map<string, { sessions: Set<string>; totalVideos: number; totalWatch: number }>();
    for (const s of sessions) {
      // Determine primary source (most common in session)
      const sourceCounts = new Map<string, number>();
      for (const src of s.feed_sources) {
        sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
      }
      let primary = "unknown";
      let maxCount = 0;
      for (const [src, count] of sourceCounts) {
        if (count > maxCount) { primary = src; maxCount = count; }
      }

      const existing = sourceMap.get(primary) || { sessions: new Set(), totalVideos: 0, totalWatch: 0 };
      existing.sessions.add(s.session_id);
      existing.totalVideos += s.video_count;
      existing.totalWatch += s.total_watch;
      sourceMap.set(primary, existing);
    }

    return Array.from(sourceMap.entries()).map(([source, data]) => ({
      source: source === "main_feed" ? "Main Feed" : source === "category_feed" ? "Category Feed" : source === "search" ? "Search" : source,
      sessions: data.sessions.size,
      avgVideos: Math.round((data.totalVideos / data.sessions.size) * 10) / 10,
      avgDuration: Math.round(data.totalWatch / data.sessions.size),
    }));
  }, [sessions]);

  // 4. Transition time (avg time between consecutive views in a session)
  const avgTransitionTime = useMemo(() => {
    let totalGaps = 0;
    let gapCount = 0;
    for (const s of sessions) {
      if (s.viewed_ats.length < 2) continue;
      const sorted = s.viewed_ats.map(t => new Date(t).getTime()).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = (sorted[i] - sorted[i - 1]) / 1000; // seconds
        if (gap > 0 && gap < 300) { // ignore gaps > 5min (probably paused)
          totalGaps += gap;
          gapCount++;
        }
      }
    }
    return gapCount > 0 ? Math.round(totalGaps / gapCount * 10) / 10 : 0;
  }, [sessions]);

  // 5. Drop-off snapshot for overview
  const dropoffSnapshot = useMemo(() => {
    const total = sessions.length || 1;
    const after1 = sessions.filter(s => s.video_count === 1).length;
    const reached10 = sessions.filter(s => s.video_count >= 10).length;
    return {
      leaveAfter1: Math.round((after1 / total) * 100),
      reach10Plus: Math.round((reached10 / total) * 100),
    };
  }, [sessions]);

  const COLORS = ["hsl(45, 100%, 50%)", "hsl(200, 80%, 50%)", "hsl(150, 70%, 45%)", "hsl(280, 60%, 55%)", "hsl(0, 70%, 55%)"];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {DATE_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={datePreset === preset.value ? "default" : "outline"}
            size="sm"
            onClick={() => onDatePresetChange(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground ml-2">
          {sessions.length.toLocaleString()} sessions analyzed
        </span>
      </div>

      {/* Drop-off Snapshot */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-destructive">{dropoffSnapshot.leaveAfter1}%</div>
            <p className="text-sm text-muted-foreground mt-1">Leave after 1 video</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-primary">{dropoffSnapshot.reach10Plus}%</div>
            <p className="text-sm text-muted-foreground mt-1">Reach 10+ videos</p>
          </CardContent>
        </Card>
      </div>

      {/* Videos Per Session Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-5 w-5" />
            Videos Per Session Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="range" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                formatter={(value: number, name: string) => [name === "percent" ? `${value}%` : value, name === "percent" ? "% of sessions" : "Sessions"]}
              />
              <Bar dataKey="count" name="Sessions" radius={[4, 4, 0, 0]}>
                {distribution.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-5 gap-2 mt-4 text-center text-xs text-muted-foreground">
            {distribution.map((d) => (
              <div key={d.range}>
                <span className="font-semibold text-foreground">{d.percent}%</span>
                <br />
                {d.range} videos
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Drop-off Curve */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-5 w-5" />
            Session Drop-off Curve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dropoffCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="videoNumber" label={{ value: "Video #", position: "insideBottom", offset: -5 }} tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} label={{ value: "% still watching", angle: -90, position: "insideLeft" }} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                formatter={(value: number) => [`${value}%`, "Still watching"]}
              />
              <Line type="monotone" dataKey="percentStill" stroke="hsl(45, 100%, 50%)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Feed Source Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-5 w-5" />
            Feed Source Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feedSourceStats.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Feed source data will appear after the tracking update is live.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium">Source</th>
                    <th className="text-right py-2 font-medium">Sessions</th>
                    <th className="text-right py-2 font-medium">Avg Videos/Session</th>
                    <th className="text-right py-2 font-medium">Avg Duration (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {feedSourceStats.map((row) => (
                    <tr key={row.source} className="border-b border-border/50">
                      <td className="py-2 font-medium">{row.source}</td>
                      <td className="text-right py-2">{row.sessions.toLocaleString()}</td>
                      <td className="text-right py-2">{row.avgVideos}</td>
                      <td className="text-right py-2">{row.avgDuration}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transition Time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-5 w-5" />
            Average Transition Time
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <div className="text-4xl font-bold">{avgTransitionTime}s</div>
          <p className="text-sm text-muted-foreground mt-1">
            Average delay between consecutive videos in a session
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {avgTransitionTime > 5 ? "⚠️ High transition time — may indicate loading friction" : 
             avgTransitionTime > 3 ? "Moderate — room for improvement" :
             "✅ Good — transitions feel smooth"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
