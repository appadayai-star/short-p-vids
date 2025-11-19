import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Heart, MessageCircle, Bookmark, UserPlus, Search } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

interface Notification {
  id: string;
  type: "like" | "comment" | "save" | "follow";
  actor_id: string;
  video_id: string | null;
  comment_id: string | null;
  is_read: boolean;
  created_at: string;
  actor: {
    username: string;
    avatar_url: string | null;
  };
  comment?: {
    content: string;
  };
}

const Inbox = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const unreadCount = useUnreadNotifications(user?.id || null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchNotifications(session.user.id);
        markAllAsRead(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchNotifications = async (userId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select(`
          id,
          type,
          actor_id,
          video_id,
          comment_id,
          is_read,
          created_at,
          actor:profiles!notifications_actor_id_fkey(username, avatar_url),
          comment:comments(content)
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications((data || []) as Notification[]);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      toast.error("Failed to load notifications");
    } finally {
      setIsLoading(false);
    }
  };

  const markAllAsRead = async (userId: string) => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      if (error) throw error;
    } catch (error) {
      console.error("Error marking notifications as read:", error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) throw error;

      setNotifications(notifications.map(n => 
        n.id === notificationId ? { ...n, is_read: true } : n
      ));
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    
    if (notification.type === "follow") {
      navigate(`/profile/${notification.actor_id}`);
    } else if (notification.video_id) {
      navigate(`/video/${notification.video_id}`);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "like":
        return <Heart className="h-5 w-5 text-red-500 fill-red-500" />;
      case "comment":
        return <MessageCircle className="h-5 w-5 text-blue-500" />;
      case "save":
        return <Bookmark className="h-5 w-5 text-yellow-500 fill-yellow-500" />;
      case "follow":
        return <UserPlus className="h-5 w-5 text-primary" />;
      default:
        return null;
    }
  };

  const getNotificationText = (notification: Notification) => {
    switch (notification.type) {
      case "like":
        return "liked your video";
      case "comment":
        return notification.comment ? `commented: "${notification.comment.content.slice(0, 50)}${notification.comment.content.length > 50 ? '...' : ''}"` : "commented on your video";
      case "save":
        return "saved your video";
      case "follow":
        return "started following you";
      default:
        return "";
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
    const diffWeek = Math.floor(diffDay / 7);

    if (diffWeek > 0) return `${diffWeek}w ago`;
    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return "Just now";
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <h1 className="text-white text-2xl font-bold mb-4">Login Required</h1>
        <p className="text-white/50 mb-6 text-center">You need to be logged in to view your inbox</p>
        <button
          onClick={() => navigate("/auth")}
          className="px-6 py-3 bg-primary text-black rounded-full font-semibold hover:scale-105 transition-transform"
        >
          Login
        </button>
        <BottomNav
          isAuthenticated={false}
          onHomeRefresh={undefined}
          unreadCount={0}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-white/10 p-4 flex items-center justify-between">
        <h1 className="text-white text-xl font-bold">Inbox</h1>
        <button
          onClick={() => navigate("/search")}
          className="p-2 hover:bg-white/5 rounded-full transition-colors"
        >
          <Search className="h-6 w-6 text-white" />
        </button>
      </div>

      {/* Notifications */}
      <ScrollArea className="h-[calc(100vh-140px)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-white/50">Loading notifications...</div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="text-white/50 text-center">
              <p className="text-lg mb-2">No notifications yet</p>
              <p className="text-sm">When someone interacts with your content, you'll see it here</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-white/5 transition-colors ${
                  !notification.is_read ? "bg-white/5" : ""
                }`}
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-white/10">
                  {notification.actor.avatar_url ? (
                    <img
                      src={notification.actor.avatar_url}
                      alt={notification.actor.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white font-bold">
                      {notification.actor.username[0].toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">
                    <span className="font-semibold">{notification.actor.username}</span>{" "}
                    <span className="text-white/70">{getNotificationText(notification)}</span>
                  </p>
                  <p className="text-white/50 text-xs mt-1">
                    {formatTimeAgo(notification.created_at)}
                  </p>
                </div>

                <div className="flex-shrink-0">
                  {getNotificationIcon(notification.type)}
                </div>

                {!notification.is_read && (
                  <div className="flex-shrink-0 w-2 h-2 bg-primary rounded-full"></div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <BottomNav
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!user}
        onHomeRefresh={undefined}
        unreadCount={unreadCount}
      />

      {user && (
        <UploadModal
          open={isUploadOpen}
          onOpenChange={setIsUploadOpen}
          userId={user.id}
        />
      )}
    </div>
  );
};

export default Inbox;
