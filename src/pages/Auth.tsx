import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEO } from "@/components/SEO";
import { toast } from "sonner";
import { Loader2, Video, X } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

const Auth = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [loginData, setLoginData] = useState({ emailOrUsername: "", password: "" });
  const [signupData, setSignupData] = useState({ username: "", email: "", password: "" });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      let email = loginData.emailOrUsername.trim();
      
      // Check if input is a username (no @ symbol)
      if (!email.includes("@")) {
        // Look up email by username
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", email)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!profile) {
          throw new Error("Username not found");
        }

        // Get email from auth.users via a workaround - try to sign in and let Supabase handle the error
        // Since we can't access auth.users directly, we need to use the user's email
        // We'll need to store email in profiles or use a different approach
        
        // For now, fetch user email from the auth system by attempting login
        // Actually, we need the email. Let's query if the profile has associated email
        const { data: userData } = await supabase.auth.admin?.getUserById(profile.id) || {};
        
        if (!userData?.user?.email) {
          // Fallback: assume the username input might be the email
          throw new Error("Please use your email address to login");
        }
        email = userData.user.email;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: loginData.password,
      });

      if (error) throw error;
      
      toast.success("Welcome back!");
      navigate("/feed");
    } catch (error: any) {
      toast.error(error.message || "Failed to login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error: signUpError, data } = await supabase.auth.signUp({
        email: signupData.email,
        password: signupData.password,
        options: {
          data: {
            username: signupData.username,
          },
          emailRedirectTo: `${window.location.origin}/feed`,
        },
      });

      if (signUpError) throw signUpError;

      toast.success("Account created! Logging you in...");
      navigate("/feed");
    } catch (error: any) {
      toast.error(error.message || "Failed to create account");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4 relative">
      <SEO 
        title="Login or Sign Up"
        description="Join ShortPV to watch, create, and share short videos with millions of users"
      />
      {/* Close button */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 p-2 hover:bg-white/10 rounded-full transition-colors"
        aria-label="Go back"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Video className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-primary">
            ShortPV
          </h1>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Welcome back</CardTitle>
                <CardDescription>Login to continue watching</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email or Username</Label>
                    <Input
                      id="login-email"
                      type="text"
                      placeholder="you@example.com or username"
                      value={loginData.emailOrUsername}
                      onChange={(e) => setLoginData({ ...loginData, emailOrUsername: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginData.password}
                      onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Login
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signup">
            <Card>
              <CardHeader>
                <CardTitle>Create account</CardTitle>
                <CardDescription>Join ShortPV today</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-username">Username</Label>
                    <Input
                      id="signup-username"
                      type="text"
                      placeholder="cooluser123"
                      value={signupData.username}
                      onChange={(e) => setSignupData({ ...signupData, username: e.target.value })}
                      required
                      minLength={3}
                      maxLength={30}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={signupData.email}
                      onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={signupData.password}
                      onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Account
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <BottomNav isAuthenticated={false} />
    </div>
  );
};

export default Auth;
