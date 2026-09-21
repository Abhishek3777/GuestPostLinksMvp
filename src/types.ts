export type DiscoverySource = "sitemap" | "wp-api" | "feed" | "html-crawl";

export interface DiscoveredPost {
  url: string;
  title?: string;
  publishedAt?: string | null;
}

export interface DiscoveryResult {
  domain: string;
  status: "success" | "no_posts_found" | "blocked" | "dns_error" | "timeout" | "error";
  source?: DiscoverySource;
  posts: DiscoveredPost[];
  reason?: string;
}
