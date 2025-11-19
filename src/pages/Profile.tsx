import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Button } from "@/components/ui/button";
import { Heart, Video, LogOut, Settings, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number;
  following_count: number;
}

interface VideoData {
  id: string;
  title: string;
  video_url: string;
  views_count: number;
  likes_count: number;
}

interface FollowUser {
  id: string;
  username: string;
  avatar_url: string | null;
  followers_count: number;
}

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myVideos, setMyVideos] = useState<VideoData[]>([]);
  const [likedVideos, setLikedVideos] = useState<VideoData[]>([]);
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/feed");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/feed");
      } else {
        fetchProfile(session.user.id);
        fetchMyVideos(session.user.id);
        fetchLikedVideos(session.user.id);
        fetchFollowers(session.user.id);
        fetchFollowing(session.user.id);
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

  const fetchFollowers = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          follower_id,
          profiles:follower_id (
            id,
            username,
            avatar_url,
            followers_count
          )
        `)
        .eq("following_id", userId);

      if (error) throw error;
      
      const users = data?.map((f: any) => f.profiles).filter(Boolean) || [];
      setFollowers(users);
    } catch (error) {
      console.error("Error fetching followers:", error);
    }
  };

  const fetchFollowing = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          following_id,
          profiles:following_id (
            id,
            username,
            avatar_url,
            followers_count
          )
        `)
        .eq("follower_id", userId);

      if (error) throw error;
      
      const users = data?.map((f: any) => f.profiles).filter(Boolean) || [];
      setFollowing(users);
    } catch (error) {
      console.error("Error fetching following:", error);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to logout");
    } else {
      toast.success("Logged out successfully");
      navigate("/feed");
    }
  };

  if (!user || !session || !profile) {
    return null;
  }

  const totalLikes = myVideos.reduce((sum, video) => sum + video.likes_count, 0);

  return (
    <div className="min-h-screen bg-black pb-20">
      {/* Profile Header */}
      <div className="border-b border-border">
        <div className="container max-w-2xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-xl font-bold text-foreground">@{profile.username}</h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-foreground hover:text-primary"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded-full bg-secondary border-4 border-primary overflow-hidden flex-shrink-0">
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

            <div className="flex-1">
              <div className="flex gap-6 mb-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-foreground">{profile.following_count}</div>
                  <div className="text-xs text-muted-foreground">Following</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-foreground">{profile.followers_count}</div>
                  <div className="text-xs text-muted-foreground">Followers</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-foreground">{totalLikes}</div>
                  <div className="text-xs text-muted-foreground">Likes</div>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="border-primary text-primary hover:bg-primary hover:text-black w-full"
              >
                <Settings className="mr-2 h-4 w-4" />
                Edit Profile
              </Button>
            </div>
          </div>

          {profile.bio && (
            <p className="text-foreground mt-4 text-sm">{profile.bio}</p>
          )}
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
          <TabsTrigger value="followers" className="flex-1 data-[state=active]:text-primary">
            <UserPlus className="h-4 w-4 mr-2" />
            Followers
          </TabsTrigger>
          <TabsTrigger value="following" className="flex-1 data-[state=active]:text-primary">
            <Users className="h-4 w-4 mr-2" />
            Following
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

        <TabsContent value="followers" className="mt-0">
          {followers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <UserPlus className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">No followers yet</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {followers.map((follower) => (
                <div key={follower.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-secondary overflow-hidden">
                      {follower.avatar_url ? (
                        <img src={follower.avatar_url} alt={follower.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg font-bold text-primary">
                          {follower.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-foreground font-semibold">@{follower.username}</p>
                      <p className="text-sm text-muted-foreground">{follower.followers_count} followers</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="following" className="mt-0">
          {following.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Users className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">Not following anyone yet</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {following.map((user) => (
                <div key={user.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-secondary overflow-hidden">
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg font-bold text-primary">
                          {user.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-foreground font-semibold">@{user.username}</p>
                      <p className="text-sm text-muted-foreground">{user.followers_count} followers</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BottomNav onUploadClick={() => setIsUploadOpen(true)} isAuthenticated={true} />
      <UploadModal 
        open={isUploadOpen} 
        onOpenChange={setIsUploadOpen}
        userId={user.id}
      />
    </div>
  );
};

export default Profile;
