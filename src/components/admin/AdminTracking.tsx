import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ExternalLink, BarChart3, Link2 } from "lucide-react";
import { format, subDays, subHours } from "date-fns";

const DOMAIN = "shortpornvids.com";

const DATE_RANGES = [
  { label: "24h", getValue: () => subHours(new Date(), 24) },
  { label: "7d", getValue: () => subDays(new Date(), 7) },
  { label: "30d", getValue: () => subDays(new Date(), 30) },
  { label: "All Time", getValue: () => new Date(0) },
];

export const AdminTracking = () => {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [dateRange, setDateRange] = useState(1); // index into DATE_RANGES

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_links")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rangeStart = DATE_RANGES[dateRange].getValue().toISOString();

  const { data: clickStats = [] } = useQuery({
    queryKey: ["tracking-clicks-stats", rangeStart, links.map((l: any) => l.id).join(",")],
    enabled: links.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_clicks")
        .select("link_id, clicked_at")
        .gte("clicked_at", rangeStart);
      if (error) throw error;
      return data;
    },
  });

  const createLink = useMutation({
    mutationFn: async () => {
      const slug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
      if (!slug || !newName.trim()) throw new Error("Name and slug are required");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("tracking_links").insert({
        slug,
        name: newName.trim(),
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking-links"] });
      setNewName("");
      setNewSlug("");
      toast.success("Tracking link created");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteLink = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tracking_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking-links"] });
      queryClient.invalidateQueries({ queryKey: ["tracking-clicks-stats"] });
      toast.success("Link deleted");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`https://${DOMAIN}/${slug}`);
    toast.success("Link copied to clipboard");
  };

  // Aggregate clicks per link
  const clickCountMap: Record<string, number> = {};
  clickStats.forEach((c: any) => {
    clickCountMap[c.link_id] = (clickCountMap[c.link_id] || 0) + 1;
  });

  const totalClicks = clickStats.length;

  return (
    <div className="space-y-6">
      {/* Create new link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5" />
            Create Tracking Link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="link-name">Name</Label>
              <Input
                id="link-name"
                placeholder="e.g. Twitter Bio"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="link-slug">Slug</Label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{DOMAIN}/</span>
                <Input
                  id="link-slug"
                  placeholder="twitter"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => createLink.mutate()}
                disabled={!newName.trim() || !newSlug.trim() || createLink.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats overview */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Click Statistics</h3>
          <Badge variant="secondary">{totalClicks} total clicks</Badge>
        </div>
        <div className="flex gap-1">
          {DATE_RANGES.map((r, i) => (
            <Button
              key={r.label}
              variant={dateRange === i ? "default" : "outline"}
              size="sm"
              onClick={() => setDateRange(i)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Links table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linksLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No tracking links yet. Create one above.
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link: any) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">{link.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          /{link.slug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={clickCountMap[link.id] ? "default" : "secondary"}>
                        {clickCountMap[link.id] || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {format(new Date(link.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyLink(link.slug)}
                          title="Copy link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteLink.mutate(link.id)}
                          title="Delete link"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
