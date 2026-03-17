/**
 * Cloudflare Worker: Bot-aware routing for /video/:id
 * 
 * Deploy this on your shortpornvids.com domain via Cloudflare Workers.
 * It intercepts requests to /video/:id and:
 *   - Bots → proxies to the og-video edge function (server-rendered OG HTML)
 *   - Browsers → passes through to the normal SPA
 *
 * Setup:
 *   1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. Paste this code
 *   3. Add a Route: shortpornvids.com/video/*
 *   4. Save & Deploy
 */

const BOT_USER_AGENTS = [
  'redditbot',
  'twitterbot',
  'facebookexternalhit',
  'facebookscraper',
  'discordbot',
  'slackbot',
  'slack-imgproxy',
  'whatsapp',
  'telegrambot',
  'linkedinbot',
  'pinterestbot',
  'applebot',
  'googlebot',
  'bingbot',
  'yandexbot',
  'embedly',
  'quora link preview',
  'outbrain',
  'vkshare',
  'skypeuripreview',
  'viber',
  'tumblr',
  'bitlybot',
  'flipboard',
  'nuzzel',
  'seznambot',
];

const OG_FUNCTION_URL =
  'https://mbuajcicosojebakdtsn.supabase.co/functions/v1/og-video';

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

function extractVideoId(pathname) {
  // Match /video/:id
  const match = pathname.match(/^\/video\/([a-zA-Z0-9\-]+)/);
  return match ? match[1] : null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const videoId = extractVideoId(url.pathname);

    // Only act on /video/:id routes
    if (!videoId) {
      return fetch(request);
    }

    const userAgent = request.headers.get('user-agent') || '';

    if (isBot(userAgent)) {
      // Proxy to edge function for server-rendered OG meta tags
      const ogUrl = `${OG_FUNCTION_URL}?id=${encodeURIComponent(videoId)}`;
      const ogResponse = await fetch(ogUrl, {
        headers: {
          'User-Agent': userAgent,
        },
      });

      // Return the OG HTML with proper headers
      return new Response(ogResponse.body, {
        status: ogResponse.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400',
          'X-Robots-Tag': 'index, follow',
        },
      });
    }

    // Human browser — pass through to origin (SPA)
    return fetch(request);
  },
};
