import { useState, useEffect } from "react";
import { X, Send, Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";

interface Comment {
  id: string;
  content: string;
  created_at: string;
  likes_count: number;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface CommentsDrawerProps {
  videoId: string;
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string | null;
  onCommentAdded?: () => void;
}

export const CommentsDrawer = ({ videoId, isOpen, onClose, currentUserId, onCommentAdded }: CommentsDrawerProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      fetchComments();
      if (currentUserId) {
        fetchLikedComments();
      }
    }
  }, [isOpen, videoId, currentUserId]);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("comments")
        .select(`
          id,
          content,
          created_at,
          likes_count,
          profiles (
            username,
            avatar_url
          )
        `)
        .eq("video_id", videoId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error("Error fetching comments:", error);
      toast.error("Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLikedComments = async () => {
    if (!currentUserId) return;
    
    try {
      const { data, error } = await supabase
        .from("comment_likes")
        .select("comment_id")
        .eq("user_id", currentUserId);

      if (error) throw error;
      setLikedComments(new Set(data?.map(like => like.comment_id) || []));
    } catch (error) {
      console.error("Error fetching liked comments:", error);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!currentUserId) {
      toast.error("Please login to like comments");
      return;
    }

    const isLiked = likedComments.has(commentId);

    try {
      if (isLiked) {
        // Unlike
        const { error } = await supabase
          .from("comment_likes")
          .delete()
          .eq("comment_id", commentId)
          .eq("user_id", currentUserId);

        if (error) throw error;

        setLikedComments(prev => {
          const newSet = new Set(prev);
          newSet.delete(commentId);
          return newSet;
        });

        setComments(prev => prev.map(comment => 
          comment.id === commentId 
            ? { ...comment, likes_count: comment.likes_count - 1 }
            : comment
        ));
      } else {
        // Like
        const { error } = await supabase
          .from("comment_likes")
          .insert({
            comment_id: commentId,
            user_id: currentUserId,
          });

        if (error) throw error;

        setLikedComments(prev => new Set(prev).add(commentId));

        setComments(prev => prev.map(comment => 
          comment.id === commentId 
            ? { ...comment, likes_count: comment.likes_count + 1 }
            : comment
        ));
      }
    } catch (error) {
      console.error("Error liking comment:", error);
      toast.error("Failed to like comment");
    }
  };

  const handleSubmitComment = async () => {
    if (!currentUserId) {
      toast.error("Please login to comment");
      return;
    }

    if (!newComment.trim()) {
      toast.error("Comment cannot be empty");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("comments").insert({
        video_id: videoId,
        user_id: currentUserId,
        content: newComment.trim(),
      });

      if (error) throw error;

      setNewComment("");
      toast.success("Comment posted!");
      fetchComments();
      onCommentAdded?.();
    } catch (error) {
      console.error("Error posting comment:", error);
      toast.error("Failed to post comment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now.getTime() - past.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return "Just now";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end md:items-center md:justify-center">
      <div className="bg-background w-full md:max-w-lg md:rounded-t-2xl rounded-t-2xl h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Comments</h2>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Comments list */}
        <ScrollArea className="flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading comments...</div>
            </div>
          ) : comments.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">No comments yet. Be the first!</div>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary overflow-hidden flex-shrink-0">
                    {comment.profiles.avatar_url ? (
                      <img
                        src={comment.profiles.avatar_url}
                        alt={comment.profiles.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground text-sm font-bold">
                        {comment.profiles.username[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{comment.profiles.username}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{comment.content}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <button
                        onClick={() => handleLikeComment(comment.id)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Heart
                          className={`h-4 w-4 ${
                            likedComments.has(comment.id)
                              ? "fill-red-500 text-red-500"
                              : ""
                          }`}
                        />
                        {comment.likes_count > 0 && (
                          <span>{comment.likes_count}</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Comment input */}
        {currentUserId ? (
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="resize-none min-h-[44px] max-h-[120px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitComment();
                  }
                }}
              />
              <Button
                onClick={handleSubmitComment}
                disabled={isSubmitting || !newComment.trim()}
                size="icon"
                className="h-[44px] w-[44px] flex-shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 border-t border-border text-center text-muted-foreground text-sm">
            Please login to comment
          </div>
        )}
      </div>
    </div>
  );
};
