import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Loader2, ChevronLeft, ChevronRight, Trash2, Heart, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Comment {
  id: string;
  content: string;
  likes_count: number;
  replies_count: number;
  created_at: string;
  user_id: string;
  video_id: string;
  parent_comment_id: string | null;
  user_email: string;
  username: string;
  video_title: string;
}

export const AdminComments = () => {
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteComment, setDeleteComment] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const limit = 20;

  const fetchComments = async () => {
    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: limit.toString(),
      };
      if (search) params.q = search;

      const queryString = new URLSearchParams(params).toString();
      
      const { data, error: fnError } = await supabase.functions.invoke(`admin-comments?${queryString}`, {
        method: 'GET',
      });

      if (fnError) throw fnError;

      setComments(data.comments);
      setTotal(data.total);
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(fetchComments, 300);
    return () => clearTimeout(debounce);
  }, [search, page]);

  const handleDelete = async () => {
    if (!deleteComment) return;

    setDeleting(true);
    try {
      const { error: fnError } = await supabase.functions.invoke('admin-delete-comment', {
        method: 'DELETE',
        body: { commentId: deleteComment.id },
      });

      if (fnError) throw fnError;

      toast({
        title: "Comment deleted",
        description: "The comment has been permanently deleted.",
      });

      setComments((prev) => prev.filter((c) => c.id !== deleteComment.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error("Error deleting comment:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete comment",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteComment(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search comments by content..."
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
              <TableHead className="min-w-[250px]">Comment</TableHead>
              <TableHead className="hidden lg:table-cell">User</TableHead>
              <TableHead className="hidden md:table-cell">Video</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
              <TableHead className="text-center">
                <Heart className="h-4 w-4 mx-auto" />
              </TableHead>
              <TableHead className="text-center">
                <MessageCircle className="h-4 w-4 mx-auto" />
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : comments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No comments found
                </TableCell>
              </TableRow>
            ) : (
              comments.map((comment) => (
                <TableRow key={comment.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="text-sm line-clamp-2">{comment.content}</div>
                      <div className="text-xs text-muted-foreground lg:hidden mt-1">
                        @{comment.username}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div>
                      <div className="font-medium">@{comment.username}</div>
                      <div className="text-xs text-muted-foreground">{comment.user_email}</div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm truncate max-w-[150px]">
                      {comment.video_title}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {format(new Date(comment.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-center">{comment.likes_count}</TableCell>
                  <TableCell className="text-center">{comment.replies_count}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteComment(comment)}
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
            Page {page} of {totalPages} ({total} comments)
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteComment} onOpenChange={(open) => { if (!open) setDeleteComment(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this comment? This will also delete all replies to this comment. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
