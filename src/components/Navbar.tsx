import { useState } from "react";
import { Video, Upload, Search, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface NavbarProps {
  onUploadClick: () => void;
  onSearch: (query: string) => void;
}

export const Navbar = ({ onUploadClick, onSearch }: NavbarProps) => {
  const navigate = useNavigate();
  const [localSearchQuery, setLocalSearchQuery] = useState("");

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to logout");
    } else {
      toast.success("Logged out successfully");
      navigate("/auth");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(localSearchQuery);
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-black">
      <div className="container flex h-16 items-center px-4">
        <div className="flex items-center gap-2 mr-6">
          <Video className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold text-primary">
            ShortPV
          </h1>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
            <Input
              type="search"
              placeholder="Search videos, users, tags..."
              className="pl-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
            />
          </div>
        </form>

        <div className="flex items-center gap-4 ml-6">
          <Button onClick={onUploadClick} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <Upload className="h-4 w-4" />
            Upload
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-primary hover:text-primary/90 hover:bg-secondary">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-secondary border-border">
              <DropdownMenuItem onClick={handleLogout} className="text-foreground hover:bg-muted">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
};
