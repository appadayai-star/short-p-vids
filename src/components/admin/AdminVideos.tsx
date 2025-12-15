import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Loader2, ChevronLeft, ChevronRight, Trash2, Eye, Heart, Bookmark, Percent } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  saved_count: number;
  created_at: string;
  user_id: string;
  uploader_email: string;
  uploader_username: string;
}

const SUPABASE_URL = "https://mbuajcicosojebakdtsn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idWFqY2ljb3NvamViYWtkdHNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NDcxMTYsImV4cCI6MjA3OTEyMzExNn0.Kl3CuR1f3sGm5UAfh3xz1979SUt9Uf9aN_03ns2Qr98";

export const AdminVideos = () => {
  const { toast } = useToast();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteVideo, setDeleteVideo] = useState<Video | null>(null);
  const [deleting, setDeleting] = useState(false);
  const limit = 20;

  const fetchVideos = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const params: Record<string, string> = {
        page: page.toString(),
        limit: limit.toString(),
      };
      if (search) params.q = search;

      const queryString = new URLSearchParams(params).toString();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-videos?${queryString}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to fetch videos");
      }

      const data = await res.json();
      setVideos(data.videos);
      setTotal(data.total);
    } catch (err) {
      console.error("Error fetching videos:", err);
      setError(err instanceof Error ? err.message : "Failed to load videos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(fetchVideos, 300);
    return () => clearTimeout(debounce);
  }, [search, page]);

  const handleDelete = async () => {
    if (!deleteVideo) return;

    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: deleteVideo.id }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete video");
      }

      toast({
        title: "Video deleted",
        description: "The video has been permanently deleted.",
      });

      setVideos((prev) => prev.filter((v) => v.id !== deleteVideo.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error("Error deleting video:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete video",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteVideo(null);
    }
  };

  const getViewLikeRatio = (views: number, likes: number) => {
    if (views === 0) return "0%";
    const ratio = (likes / views) * 100;
    return `${ratio.toFixed(1)}%`;
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by title, description, or video ID..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-10"
        />
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
          {error}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Video</TableHead>
              <TableHead className="hidden lg:table-cell">Uploader</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead className="text-center"><Eye className="h-4 w-4 mx-auto" /></TableHead>
              <TableHead className="text-center"><Heart className="h-4 w-4 mx-auto" /></TableHead>
              <TableHead className="text-center"><Bookmark className="h-4 w-4 mx-auto" /></TableHead>
              <TableHead className="text-center"><Percent className="h-4 w-4 mx-auto" /></TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : videos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No videos found
                </TableCell>
              </TableRow>
            ) : (
              videos.map((video) => (
                <TableRow key={video.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {video.thumbnail_url && (
                        <img src={video.thumbnail_url} alt={video.title} className="w-16 h-10 object-cover rounded" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate max-w-[150px]">{video.title || "Untitled"}</div>
                        <div className="text-xs text-muted-foreground lg:hidden">{video.uploader_username}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div>
                      <div className="font-medium">{video.uploader_username}</div>
                      <div className="text-xs text-muted-foreground">{video.uploader_email}</div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {format(new Date(video.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-center">{video.views_count}</TableCell>
                  <TableCell className="text-center">{video.likes_count}</TableCell>
                  <TableCell className="text-center">{video.saved_count}</TableCell>
                  <TableCell className="text-center">{getViewLikeRatio(video.views_count, video.likes_count)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteVideo(video)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} videos)
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteVideo} onOpenChange={(open) => { if (!open) setDeleteVideo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Video</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this video? This action cannot be undone.
              The video will be removed from the database and storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
