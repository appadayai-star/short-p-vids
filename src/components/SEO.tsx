import { Helmet } from "react-helmet-async";

interface VideoStructuredData {
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: string;
  contentUrl: string;
  duration?: string;
  creator?: string;
  viewCount?: number;
  interactionCount?: number;
}

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: "website" | "video.other" | "profile";
  noIndex?: boolean;
  videoData?: VideoStructuredData;
}

const defaults = {
  siteName: "ShortPornVids",
  title: "Short Porn Clips Porno Videos XXX – ShortPornVids",
  description:
    "Watch free short porn videos and porn clips on ShortPornVids. Discover trending XXX clips, vertical mobile porn, TikTok-style videos, and endless adult content.",
  keywords:
    "short porn videos, short porn clips, free porn clips, porn clips, xxx clips, short xxx videos, vertical porn videos, mobile porn, tiktok porn, trending porn videos, hd porn clips",
  image: "https://shortpornvids.com/og-image.jpg",
  url: "https://shortpornvids.com",
};

// Helper to generate VideoObject JSON-LD structured data
const generateVideoStructuredData = (video: VideoStructuredData) => ({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: video.name,
  description: video.description,
  thumbnailUrl: video.thumbnailUrl,
  uploadDate: video.uploadDate,
  contentUrl: video.contentUrl,
  ...(video.duration && { duration: video.duration }),
  ...(video.creator && {
    creator: {
      "@type": "Person",
      name: video.creator,
    },
  }),
  ...(video.viewCount && {
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/WatchAction",
      userInteractionCount: video.viewCount,
    },
  }),
});

// Helper to generate WebSite JSON-LD structured data
const generateWebsiteStructuredData = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: defaults.siteName,
  url: defaults.url,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${defaults.url}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
});

// Helper to generate Organization JSON-LD structured data
const generateOrganizationStructuredData = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: defaults.siteName,
  url: defaults.url,
  logo: defaults.image,
});

export const SEO = ({
  title,
  description = defaults.description,
  keywords = defaults.keywords,
  image = defaults.image,
  url = defaults.url,
  type = "website",
  noIndex = false,
  videoData,
}: SEOProps) => {
  const fullTitle = title ? `${title} | ${defaults.siteName}` : defaults.title;
  const structuredData = videoData
    ? generateVideoStructuredData(videoData)
    : type === "website"
      ? generateWebsiteStructuredData()
      : null;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content={defaults.siteName} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* Canonical */}
      <link rel="canonical" href={url} />

      {/* JSON-LD Structured Data */}
      {structuredData && <script type="application/ld+json">{JSON.stringify(structuredData)}</script>}

      {/* Organization structured data for homepage */}
      {type === "website" && !videoData && (
        <script type="application/ld+json">{JSON.stringify(generateOrganizationStructuredData())}</script>
      )}
    </Helmet>
  );
};

// Export defaults for easy configuration updates
export const SEODefaults = defaults;

// Export helper for generating video metadata
export const generateVideoSEO = (video: {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  video_url: string;
  created_at?: string;
  views_count?: number;
  tags?: string[] | null;
  profiles?: { username: string } | null;
}) => ({
  title: video.title,
  description: video.description || `Watch ${video.title} on ${defaults.siteName}`,
  keywords: video.tags?.join(", ") || defaults.keywords,
  image: video.thumbnail_url || defaults.image,
  url: `${defaults.url}/video/${video.id}`,
  type: "video.other" as const,
  videoData: {
    name: video.title,
    description: video.description || `Watch ${video.title}`,
    thumbnailUrl: video.thumbnail_url || defaults.image,
    uploadDate: video.created_at || new Date().toISOString(),
    contentUrl: video.video_url,
    creator: video.profiles?.username,
    viewCount: video.views_count,
  },
});

// Export helper for generating category page metadata
export const generateCategorySEO = (category: string) => ({
  title: `${category} Porn Clips & Short Videos XXX`,
  description: `Watch the best ${category.toLowerCase()} porn clips and short XXX videos on ${defaults.siteName}. Free, mobile-friendly, and trending now.`,
  keywords: `${category.toLowerCase()} porn clips, ${category.toLowerCase()} short porn videos, free ${category.toLowerCase()} xxx, ${category.toLowerCase()} mobile porn`,
  url: `${defaults.url}/feed?category=${encodeURIComponent(category)}`,
});

// Export helper for generating profile page metadata
export const generateProfileSEO = (profile: {
  username: string;
  bio?: string | null;
  avatar_url?: string | null;
  followers_count?: number;
}) => ({
  title: `@${profile.username}`,
  description: profile.bio || `Check out @${profile.username}'s videos on ${defaults.siteName}`,
  image: profile.avatar_url || defaults.image,
  url: `${defaults.url}/profile/${profile.username}`,
  type: "profile" as const,
});
