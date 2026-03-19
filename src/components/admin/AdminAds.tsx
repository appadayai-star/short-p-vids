import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { 
  Plus, Loader2, Trash2, ExternalLink, Eye, MousePointer, 
  Upload, Radio, TrendingUp
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Ad {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  external_link: string;
  is_active: boolean;
  created_at: string;
  views_count?: number;
  clicks_count?: number;
  ctr?: number;
}

export const AdminAds = () => {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Form state
  const [title, setTitle] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAds = async () => {
    setLoading(true);
    try {
      const { data: adsData, error } = await supabase
        .from("ads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch view/click counts for each ad
      const adsWithStats = await Promise.all(
        (adsData || []).map(async (ad: any) => {
          const [viewsRes, clicksRes] = await Promise.all([
            supabase.from("ad_views").select("id", { count: "exact", head: true }).eq("ad_id", ad.id),
            supabase.from("ad_clicks").select("id", { count: "exact", head: true }).eq("ad_id", ad.id),
          ]);
          
          const views = viewsRes.count || 0;
          const clicks = clicksRes.count || 0;
          
          return {
            ...ad,
            views_count: views,
            clicks_count: clicks,
            ctr: views > 0 ? Math.round((clicks / views) * 10000) / 100 : 0,
          };
        })
      );

      setAds(adsWithStats);
    } catch (err) {
      console.error("Error fetching ads:", err);
      toast.error("Failed to load ads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, []);

  const handleUploadAndCreate = async () => {
    if (!title.trim() || !externalLink.trim() || !videoFile) {
      toast.error("Please fill in all fields and select a video");
      return;
    }

    setCreating(true);
    setUploading(true);

    try {
      // Upload video to storage
      const fileExt = videoFile.name.split(".").pop();
      const fileName = `ad_${Date.now()}.${fileExt}`;
      const filePath = `ads/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, videoFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath);

      setUploading(false);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create ad record
      const { error: insertError } = await supabase.from("ads").insert({
        title: title.trim(),
        video_url: urlData.publicUrl,
        external_link: externalLink.trim(),
        is_active: true,
        created_by: user.id,
      });

      if (insertError) throw insertError;

      toast.success("Ad created successfully");
      setTitle("");
      setExternalLink("");
      setVideoFile(null);
      setShowForm(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchAds();
    } catch (err) {
      console.error("Error creating ad:", err);
      toast.error("Failed to create ad");
    } finally {
      setCreating(false);
      setUploading(false);
    }
  };

  const toggleAdStatus = async (adId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("ads")
        .update({ is_active: !currentStatus, updated_at: new Date().toISOString() })
        .eq("id", adId);

      if (error) throw error;
      
      setAds(prev => prev.map(ad => 
        ad.id === adId ? { ...ad, is_active: !currentStatus } : ad
      ));
      toast.success(`Ad ${!currentStatus ? "activated" : "deactivated"}`);
    } catch (err) {
      toast.error("Failed to update ad status");
    }
  };

  const deleteAd = async (adId: string) => {
    try {
      const { error } = await supabase.from("ads").delete().eq("id", adId);
      if (error) throw error;
      
      setAds(prev => prev.filter(ad => ad.id !== adId));
      toast.success("Ad deleted");
    } catch (err) {
      toast.error("Failed to delete ad");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Ads Manager</h2>
          <p className="text-sm text-muted-foreground">
            Manage livestream-style ads that appear in the video feed
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Ad
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create New Ad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ad-title">Title</Label>
              <Input
                id="ad-title"
                placeholder="e.g. Summer Sale Live"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ad-link">External Link</Label>
              <Input
                id="ad-link"
                placeholder="https://example.com/landing-page"
                value={externalLink}
                onChange={(e) => setExternalLink(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ad-video">Video File</Label>
              <Input
                ref={fileInputRef}
                id="ad-video"
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
              {videoFile && (
                <p className="text-xs text-muted-foreground">
                  Selected: {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleUploadAndCreate} disabled={creating} className="gap-2">
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {uploading ? "Uploading..." : "Creating..."}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Create Ad
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{ads.length}</div>
            <p className="text-xs text-muted-foreground">Total Ads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-500">
              {ads.filter(a => a.is_active).length}
            </div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {ads.reduce((sum, a) => sum + (a.views_count || 0), 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Total Views</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {ads.reduce((sum, a) => sum + (a.clicks_count || 0), 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Total Clicks</p>
          </CardContent>
        </Card>
      </div>

      {/* Ads List */}
      {ads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Radio className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No ads yet</p>
            <p className="text-sm">Create your first livestream ad to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {ads.map((ad) => (
            <Card key={ad.id} className={!ad.is_active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Video Preview */}
                  <div className="relative w-24 h-36 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    <video
                      src={ad.video_url}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                    {ad.is_active && (
                      <div className="absolute top-1 left-1">
                        <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0 border-0 animate-pulse">
                          LIVE
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold truncate">{ad.title}</h3>
                        <a
                          href={ad.external_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {ad.external_link.length > 40
                            ? ad.external_link.substring(0, 40) + "..."
                            : ad.external_link}
                        </a>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={ad.is_active}
                          onCheckedChange={() => toggleAdStatus(ad.id, ad.is_active)}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Ad</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{ad.title}" and all its analytics data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteAd(ad.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Eye className="h-3.5 w-3.5" />
                        {(ad.views_count || 0).toLocaleString()} views
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MousePointer className="h-3.5 w-3.5" />
                        {(ad.clicks_count || 0).toLocaleString()} clicks
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {ad.ctr || 0}% CTR
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Created {new Date(ad.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
