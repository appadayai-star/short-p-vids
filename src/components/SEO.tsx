import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "video.other" | "profile";
  noIndex?: boolean;
}

const defaults = {
  siteName: "ShortPornVids",
  title: "ShortPornVids – Endless Short-Form Videos",
  description:
    "ShortPornVids is a modern short-form video platform offering fast, personalized content discovery. Scroll instantly through an endless feed of creator-driven clips optimized for mobile viewing.",
  image: "/og-image.png",
  url: "https://shortpornvids.com",
};

export const SEO = ({
  title,
  description = defaults.description,
  image = defaults.image,
  url = defaults.url,
  type = "website",
  noIndex = false,
}: SEOProps) => {
  const fullTitle = title ? `${title} | ${defaults.siteName}` : defaults.title;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content={defaults.siteName} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* Canonical */}
      <link rel="canonical" href={url} />
    </Helmet>
  );
};
