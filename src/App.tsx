import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "./pages/Auth";
import Feed from "./pages/Feed";
import Search from "./pages/Search";
import Categories from "./pages/Categories";
import Profile from "./pages/Profile";
import Inbox from "./pages/Inbox";
import Video from "./pages/Video";
import EmbedVideo from "./pages/EmbedVideo";
import Admin from "./pages/Admin";
import TrackingRedirect from "./pages/TrackingRedirect";
import Upload from "./pages/Upload";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Feed />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/search" element={<Search />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:userId" element={<Profile />} />
              <Route path="/video/:videoId" element={<Video />} />
              <Route path="/embed/video/:videoId" element={<EmbedVideo />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/:slug" element={<TrackingRedirect />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </HelmetProvider>
);

export default App;
