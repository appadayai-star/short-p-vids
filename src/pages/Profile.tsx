import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Button } from "@/components/ui/button";
import { Heart, Video, LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
}

interface VideoData {
  id: string;
  title: string;
  video_url: string;
  views_count: number;
  likes_count: number;
}

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myVideos, setMyVideos] = useState<VideoData[]>([]);
  const [likedVideos, setLikedVideos] = useState<VideoData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      } else {
        fetchProfile(session.user.id);
        fetchMyVideos(session.user.id);
        fetchLikedVideos(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  const fetchMyVideos = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, video_url, views_count, likes_count")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMyVideos(data || []);
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLikedVideos = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("likes")
        .select(`
          video_id,
          videos (
            id,
            title,
            video_url,
            views_count,
            likes_count
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const videos = data?.map((like: any) => like.videos).filter(Boolean) || [];
      setLikedVideos(videos);
    } catch (error) {
      console.error("Error fetching liked videos:", error);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to logout");
    } else {
      toast.success("Logged out successfully");
      navigate("/auth");
    }
  };

  if (!user || !session || !profile) {
    return null;
  }

  const totalLikes = myVideos.reduce((sum, video) => sum + video.likes_count, 0);
  const totalViews = myVideos.reduce((sum, video) => sum + video.views_count, 0);

  return (
    <div className="min-h-screen bg-black pb-20">
      {/* Profile Header */}
      <div className="border-b border-border">
        <div className="container max-w-2xl mx-auto px-4 py-6">
          <div className="flex justify-end mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-foreground hover:text-primary"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-24 h-24 rounded-full bg-secondary border-4 border-primary overflow-hidden">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-primary">
                  {profile.username[0].toUpperCase()}
                </div>
              )}
            </div>

            <div>
              <h1 className="text-2xl font-bold text-foreground">@{profile.username}</h1>
              {profile.bio && (
                <p className="text-muted-foreground mt-2">{profile.bio}</p>
              )}
            </div>

            <div className="flex gap-8 text-center">
              <div>
                <div className="text-xl font-bold text-foreground">{myVideos.length}</div>
                <div className="text-sm text-muted-foreground">Videos</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">{totalLikes}</div>
                <div className="text-sm text-muted-foreground">Likes</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">{totalViews}</div>
                <div className="text-sm text-muted-foreground">Views</div>
              </div>
            </div>

            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary hover:text-black"
            >
              <Settings className="mr-2 h-4 w-4" />
              Edit Profile
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="videos" className="container max-w-2xl mx-auto">
        <TabsList className="w-full bg-black border-b border-border rounded-none h-12">
          <TabsTrigger value="videos" className="flex-1 data-[state=active]:text-primary">
            <Video className="h-4 w-4 mr-2" />
            Videos
          </TabsTrigger>
          <TabsTrigger value="liked" className="flex-1 data-[state=active]:text-primary">
            <Heart className="h-4 w-4 mr-2" />
            Liked
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading...</div>
            </div>
          ) : myVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Video className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">No videos yet</p>
              <Button onClick={() => setIsUploadOpen(true)} className="bg-primary text-black hover:bg-primary/90">
                Upload your first video
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1 p-1">
              {myVideos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => navigate("/feed")}
                  className="aspect-[9/16] bg-muted rounded-lg overflow-hidden relative group"
                >
                  <video
                    src={video.video_url}
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="text-white text-sm font-semibold">
                      {video.views_count} views
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="liked" className="mt-0">
          {likedVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Heart className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">No liked videos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1 p-1">
              {likedVideos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => navigate("/feed")}
                  className="aspect-[9/16] bg-muted rounded-lg overflow-hidden relative group"
                >
                  <video
                    src={video.video_url}
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="text-white text-sm font-semibold">
                      {video.views_count} views
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BottomNav onUploadClick={() => setIsUploadOpen(true)} />
      <UploadModal 
        open={isUploadOpen} 
        onOpenChange={setIsUploadOpen}
        userId={user.id}
      />
    </div>
  );
};

export default Profile;
