import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Eye, UserPlus, Heart, Bookmark, CalendarIcon, Loader2, Video } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DailyStats {
  date: string;
  views: number;
  signups: number;
  likes: number;
  saves: number;
  uploads: number;
}

interface Stats {
  views: number;
  signups: number;
  likes: number;
  saves: number;
  uploads: number;
  daily: DailyStats[];
}

const SUPABASE_URL = "https://mbuajcicosojebakdtsn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idWFqY2ljb3NvamViYWtkdHNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NDcxMTYsImV4cCI6MjA3OTEyMzExNn0.Kl3CuR1f3sGm5UAfh3xz1979SUt9Uf9aN_03ns2Qr98";

export const AdminStats = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("7d");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  // Helper to get UTC start of day
  const toUTCStartOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
  };

  // Helper to get UTC end of day
  const toUTCEndOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
  };

  const handlePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    
    switch (preset) {
      case "today":
        setDateRange({ from: now, to: now });
        break;
      case "7d":
        setDateRange({ from: subDays(now, 7), to: now });
        break;
      case "30d":
        setDateRange({ from: subDays(now, 30), to: now });
        break;
      case "custom":
        break;
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      if (!dateRange?.from || !dateRange?.to) return;

      setLoading(true);
      setError(null);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        // Use UTC boundaries for consistent date handling
        const startDate = toUTCStartOfDay(dateRange.from).toISOString();
        const endDate = toUTCEndOfDay(dateRange.to).toISOString();

        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/admin-stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: SUPABASE_ANON_KEY,
            },
          }
        );

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to fetch stats");
        }

        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [dateRange]);

  const statCards = [
    { title: "Total Views", value: stats?.views ?? 0, icon: Eye, color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { title: "New Signups", value: stats?.signups ?? 0, icon: UserPlus, color: "text-green-500", bgColor: "bg-green-500/10" },
    { title: "Total Likes", value: stats?.likes ?? 0, icon: Heart, color: "text-red-500", bgColor: "bg-red-500/10" },
    { title: "Total Saves", value: stats?.saves ?? 0, icon: Bookmark, color: "text-purple-500", bgColor: "bg-purple-500/10" },
    { title: "Uploaded Videos", value: stats?.uploads ?? 0, icon: Video, color: "text-orange-500", bgColor: "bg-orange-500/10" },
  ];

  const chartData = stats?.daily?.map(d => ({
    ...d,
    date: format(new Date(d.date), "MMM d"),
  })) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <Select value={datePreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="custom">Custom range</SelectItem>
          </SelectContent>
        </Select>

        {datePreset === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {error && <div className="p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <div className={cn("p-2 rounded-full", stat.bgColor)}>
                <stat.icon className={cn("h-4 w-4", stat.color)} />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Daily Trends</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Legend />
                <Line type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2} dot={false} name="Views" />
                <Line type="monotone" dataKey="signups" stroke="#22c55e" strokeWidth={2} dot={false} name="Signups" />
                <Line type="monotone" dataKey="likes" stroke="#ef4444" strokeWidth={2} dot={false} name="Likes" />
                <Line type="monotone" dataKey="saves" stroke="#a855f7" strokeWidth={2} dot={false} name="Saves" />
                <Line type="monotone" dataKey="uploads" stroke="#f97316" strokeWidth={2} dot={false} name="Uploads" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No data available for the selected period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
