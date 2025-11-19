import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Video, Sparkles, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20">
        <div className="text-center space-y-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-8">
            <Video className="h-12 w-12 text-primary" />
            <h1 className="text-5xl font-bold text-primary">
              ShortPV
            </h1>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">
            Discover endless short videos
          </h2>
          
          <p className="text-xl text-muted-foreground">
            Watch, create, and share captivating short-form content with a personalized feed
          </p>

          <div className="flex gap-4 justify-center pt-8">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="text-lg px-8"
            >
              Get Started
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/auth")}
              className="text-lg px-8"
            >
              Login
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mt-24">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold">Personalized Feed</h3>
            <p className="text-muted-foreground">
              Intelligent algorithm learns what you love and shows you more of it
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="w-16 h-16 mx-auto bg-accent/10 rounded-full flex items-center justify-center">
              <TrendingUp className="h-8 w-8 text-accent" />
            </div>
            <h3 className="text-xl font-semibold">Trending Content</h3>
            <p className="text-muted-foreground">
              Stay updated with the latest viral videos and trending creators
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold">Connect & Share</h3>
            <p className="text-muted-foreground">
              Upload your own videos and build a following in our vibrant community
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
