import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "@/hooks/useAdmin";
import { AdminStats } from "@/components/admin/AdminStats";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminVideos } from "@/components/admin/AdminVideos";
import { AdminAds } from "@/components/admin/AdminAds";
import { AdminTracking } from "@/components/admin/AdminTracking";
import { AdminSessionAnalysis } from "@/components/admin/AdminSessionAnalysis";

import { SEO } from "@/components/SEO";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, LayoutDashboard, Users, Video, ArrowLeft, Link2, Radio, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const Admin = () => {
  const navigate = useNavigate();
  const { user, isAdmin, loading } = useAdmin();
  const [datePreset, setDatePreset] = useState("7d");
  const [unmigratedCount, setUnmigratedCount] = useState(0);

  useEffect(() => {
    supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .is("cloudflare_video_id", null)
      .then(({ count }) => setUnmigratedCount(count || 0));
  }, []);


  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate("/auth");
      } else if (!isAdmin) {
        navigate("/feed");
      }
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{
        '--background': '0 0% 100%',
        '--foreground': '0 0% 0%',
        '--card': '0 0% 100%',
        '--card-foreground': '0 0% 0%',
        '--popover': '0 0% 100%',
        '--popover-foreground': '0 0% 0%',
        '--primary': '45 100% 50%',
        '--primary-foreground': '0 0% 0%',
        '--secondary': '0 0% 96%',
        '--secondary-foreground': '0 0% 9%',
        '--muted': '0 0% 96%',
        '--muted-foreground': '0 0% 45%',
        '--accent': '0 0% 96%',
        '--accent-foreground': '0 0% 9%',
        '--destructive': '0 84.2% 60.2%',
        '--destructive-foreground': '0 0% 100%',
        '--border': '0 0% 90%',
        '--input': '0 0% 90%',
        '--ring': '45 100% 50%',
      } as React.CSSProperties}
    >
      <SEO title="Admin Dashboard" noIndex />
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/feed")}
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Admin Dashboard</h1>
            </div>
          </div>
        </div>
      </header>

      {unmigratedCount > 0 && (
        <div className="container mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span><strong>{unmigratedCount}</strong> video{unmigratedCount !== 1 ? 's' : ''} missing Cloudflare Stream ID.</span>
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full max-w-3xl grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
            </TabsTrigger>
            <TabsTrigger value="videos" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              <span className="hidden sm:inline">Videos</span>
            </TabsTrigger>
            <TabsTrigger value="ads" className="flex items-center gap-2">
              <Radio className="h-4 w-4" />
              <span className="hidden sm:inline">Ads</span>
            </TabsTrigger>
            <TabsTrigger value="tracking" className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              <span className="hidden sm:inline">Tracking</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <AdminStats datePreset={datePreset} onDatePresetChange={setDatePreset} />
          </TabsContent>

          <TabsContent value="users">
            <AdminUsers />
          </TabsContent>

          <TabsContent value="videos">
            <AdminVideos />
          </TabsContent>

          <TabsContent value="ads">
            <AdminAds />
          </TabsContent>

          <TabsContent value="tracking">
            <AdminTracking datePreset={datePreset} onDatePresetChange={setDatePreset} />
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
};

export default Admin;
