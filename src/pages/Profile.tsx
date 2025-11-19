import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, Edit, ArrowLeft, UserPlus, UserMinus } from "lucide-react";

const Profile = () => {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myVideos, setMyVideos] = useState<any[]>([]);
  const [likedVideos, setLikedVideos] = useState<any[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [totalLikes, setTotalLikes] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  const isOwnProfile = !userId || userId === currentUser?.id;

  useEffect(() => {
    checkUser();
  }, [userId]);

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUser(user);

    const profileId = userId || user?.id;
    
    if (!profileId) {
      navigate("/auth");
      return;
    }

    await fetchProfile(profileId);
    await fetchUserVideos(profileId);
    if (userId) {
      await checkFollowStatus(user?.id, userId);
    } else if (user) {
      await fetchLikedVideos(user.id);
    }
    await fetchFollowers(profileId);
    await fetchFollowing(profileId);
    setIsLoading(false);
  };

  const checkFollowStatus = async (currentUserId: string | undefined, targetUserId: string) => {
    if (!currentUserId) return;

    const { data } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", currentUserId)
      .eq("following_id", targetUserId)
      .maybeSingle();

    setIsFollowing(!!data);
  };

  const fetchProfile = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  const fetchUserVideos = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, video_url, thumbnail_url, views_count, likes_count")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMyVideos(data || []);

      const totalLikesCount = data?.reduce((sum, video) => sum + video.likes_count, 0) || 0;
      setTotalLikes(totalLikesCount);
    } catch (error) {
      console.error("Error fetching videos:", error);
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
            thumbnail_url,
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

  const fetchFollowers = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          id,
          follower_id,
          profiles!follows_follower_id_fkey (
            username,
            avatar_url
          )
        `)
        .eq("following_id", profileId);

      if (error) throw error;
      setFollowers(data || []);
    } catch (error) {
      console.error("Error fetching followers:", error);
    }
  };

  const fetchFollowing = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          id,
          following_id,
          profiles!follows_following_id_fkey (
            username,
            avatar_url
          )
        `)
        .eq("follower_id", profileId);

      if (error) throw error;
      setFollowing(data || []);
    } catch (error) {
      console.error("Error fetching following:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/feed");
  };

  const handleFollowToggle = async () => {
    if (!currentUser || !userId) return;

    setIsFollowLoading(true);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUser.id)
          .eq("following_id", userId);

        if (error) throw error;
        setIsFollowing(false);
        toast.success("Unfollowed successfully");
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({
            follower_id: currentUser.id,
            following_id: userId,
          });

        if (error) throw error;
        setIsFollowing(true);
        toast.success("Following successfully");
      }
      
      await fetchProfile(userId);
    } catch (error) {
      console.error("Error toggling follow:", error);
      toast.error("Failed to update follow status");
    } finally {
      setIsFollowLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">Profile not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            {userId && (
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <h1 className="text-2xl font-bold">{isOwnProfile ? "Profile" : profile?.username}</h1>
          </div>
          {isOwnProfile && (
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Profile Info */}
        <div className="space-y-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-full bg-secondary overflow-hidden">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground text-3xl font-bold">
                  {profile.username[0].toUpperCase()}
                </div>
              )}
            </div>
            
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{profile?.username}</h2>
              {profile?.bio && (
                <p className="text-muted-foreground mt-1">{profile.bio}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{myVideos.length}</div>
              <div className="text-sm text-muted-foreground">Videos</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{profile?.followers_count || 0}</div>
              <div className="text-sm text-muted-foreground">Followers</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{profile?.following_count || 0}</div>
              <div className="text-sm text-muted-foreground">Following</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{totalLikes}</div>
              <div className="text-sm text-muted-foreground">Likes</div>
            </div>
          </div>

          {/* Action Button */}
          {isOwnProfile ? (
            <Button variant="outline" className="w-full">
              <Edit className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
          ) : (
            <Button 
              variant={isFollowing ? "outline" : "default"}
              className="w-full"
              onClick={handleFollowToggle}
              disabled={isFollowLoading}
            >
              {isFollowing ? (
                <>
                  <UserMinus className="h-4 w-4 mr-2" />
                  Unfollow
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Follow
                </>
              )}
            </Button>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="videos" className="w-full">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="videos">{isOwnProfile ? "My Videos" : "Videos"}</TabsTrigger>
            {isOwnProfile && <TabsTrigger value="liked">Liked</TabsTrigger>}
            <TabsTrigger value="followers">Followers</TabsTrigger>
            <TabsTrigger value="following">Following</TabsTrigger>
          </TabsList>

          <TabsContent value="videos">
            <div className="grid grid-cols-3 gap-1">
              {myVideos.length === 0 ? (
                <div className="col-span-3 text-center py-8 text-muted-foreground">
                  No videos yet
                </div>
              ) : (
                myVideos.map((video) => (
                  <div
                    key={video.id}
                    className="aspect-[9/16] bg-muted rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate(`/video/${video.id}`)}
                  >
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-secondary">
                        <span className="text-secondary-foreground">No thumbnail</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {isOwnProfile && (
            <TabsContent value="liked">
              <div className="grid grid-cols-3 gap-1">
                {likedVideos.length === 0 ? (
                  <div className="col-span-3 text-center py-8 text-muted-foreground">
                    No liked videos yet
                  </div>
                ) : (
                  likedVideos.map((video) => (
                    <div
                      key={video.id}
                      className="aspect-[9/16] bg-muted rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => navigate(`/video/${video.id}`)}
                    >
                      {video.thumbnail_url ? (
                        <img
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-secondary">
                          <span className="text-secondary-foreground">No thumbnail</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          )}

          <TabsContent value="followers">
            <div className="space-y-2">
              {followers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No followers yet
                </div>
              ) : (
                followers.map((follower: any) => (
                  <div
                    key={follower.id}
                    className="flex items-center justify-between p-3 hover:bg-accent rounded-lg transition-colors cursor-pointer"
                    onClick={() => navigate(`/profile/${follower.follower_id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-secondary overflow-hidden">
                        {follower.profiles.avatar_url ? (
                          <img
                            src={follower.profiles.avatar_url}
                            alt={follower.profiles.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                            {follower.profiles.username[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold">{follower.profiles.username}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="following">
            <div className="space-y-2">
              {following.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Not following anyone yet
                </div>
              ) : (
                following.map((follow: any) => (
                  <div
                    key={follow.id}
                    className="flex items-center justify-between p-3 hover:bg-accent rounded-lg transition-colors cursor-pointer"
                    onClick={() => navigate(`/profile/${follow.following_id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-secondary overflow-hidden">
                        {follow.profiles.avatar_url ? (
                          <img
                            src={follow.profiles.avatar_url}
                            alt={follow.profiles.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-secondary text-secondary-foreground font-bold">
                            {follow.profiles.username[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold">{follow.profiles.username}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <BottomNav isAuthenticated={!!currentUser} />
    </div>
  );
};

export default Profile;
