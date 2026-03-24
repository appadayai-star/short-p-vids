import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CATEGORIES = [
  { id: "beauty", name: "Beauty" },
  { id: "real", name: "Real" },
  { id: "public", name: "Public" },
  { id: "homemade", name: "Homemade" },
  { id: "pov", name: "POV" },
  { id: "mom", name: "Mom" },
  { id: "milf", name: "MILF" },
  { id: "amateur", name: "Amateur" },
  { id: "latina", name: "Latina" },
  { id: "asian", name: "Asian" },
  { id: "big_ass", name: "Big Ass" },
  { id: "big_tits", name: "Big Tits" },
  { id: "lesbian", name: "Lesbian" },
  { id: "blonde", name: "Blonde" },
  { id: "brunettes", name: "Brunettes" },
  { id: "red_head", name: "Red Head" },
  { id: "small", name: "Small" },
  { id: "stepsis", name: "Stepsis" },
  { id: "anal", name: "Anal" },
  { id: "blowjob", name: "Blowjob" },
  { id: "teen", name: "Teen" },
  { id: "goth", name: "Goth" },
  { id: "cumshot", name: "Cumshot" },
  { id: "squirt", name: "Squirt" },
];

interface EditVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  initialDescription: string | null;
  initialTags: string[] | null;
  onSaved: (description: string, tags: string[]) => void;
}

export const EditVideoDialog = ({
  open,
  onOpenChange,
  videoId,
  initialDescription,
  initialTags,
  onSaved,
}: EditVideoDialogProps) => {
  const [description, setDescription] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription(initialDescription || "");
      setSelectedCategories(initialTags || []);
    }
  }, [open, initialDescription, initialTags]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("videos")
        .update({
          description: description.trim() || null,
          tags: selectedCategories.length > 0 ? selectedCategories : null,
        })
        .eq("id", videoId);

      if (error) throw error;

      onSaved(description.trim(), selectedCategories);
      toast.success("Video updated");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to update video");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl bg-zinc-900 border-white/10 text-white z-[60] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">Edit Video</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Description */}
          <div className="space-y-2">
            <Label className="text-white/80">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              className="resize-none rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 min-h-[80px]"
              rows={3}
            />
          </div>

          {/* Categories */}
          <div className="space-y-3">
            <Label className="text-white/80">Categories</Label>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((category) => (
                <div key={category.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`edit-category-${category.id}`}
                    checked={selectedCategories.includes(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    className="border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <label
                    htmlFor={`edit-category-${category.id}`}
                    className="text-sm font-medium leading-none cursor-pointer text-white/90"
                  >
                    {category.name}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-3 pt-2">
            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
