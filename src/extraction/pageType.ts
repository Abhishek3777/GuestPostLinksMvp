// WordPress writes the post type straight into <body class="...">, via the
// core body_class() template function — this holds across virtually every
// WP theme, unlike theme-specific content-area markup. Confirmed live across
// 3 different themes (Kadence, Bloglo, GeneratePress):
//   single-post           -> a real blog post
//   archive (+ category-*) -> a category/tag/author listing page
//   page (without single-post) -> a static WP Page (e.g. "write for us")
export type WordPressPageType = "post" | "archive" | "page" | "unknown";

export function classifyWordPressPageType(html: string): WordPressPageType {
  const match = html.match(/<body[^>]*class="([^"]*)"/i);
  if (!match) return "unknown";

  const classes = match[1];
  if (/\bsingle-post\b/.test(classes)) return "post";
  if (/\barchive\b/.test(classes)) return "archive";
  if (/\bpage\b/.test(classes)) return "page";
  return "unknown";
}
