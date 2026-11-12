/**
 * Dependency-free RSS 2.0 / Atom 1.0 parser.
 *
 * RegEx parsing is deliberate: the payload is a flat list of items, the content
 * is untrusted, and a real XML parser adds an attack surface for no benefit
 * here. Only the fields the evidence layer needs are extracted.
 */

function decodeEntities(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

function attr(block, name, attribute) {
  const match = block.match(new RegExp(`<${name}[^>]*\\b${attribute}="([^"]+)"`, "i"));
  return match ? decodeEntities(match[1]) : null;
}

export function parseFeed(xml, { limit = 25 } = {}) {
  if (typeof xml !== "string" || !xml.trim()) return [];

  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const entries = [];

  for (const block of blocks.slice(0, limit)) {
    const title = tag(block, ["title"]);
    const link = tag(block, ["link"]) || attr(block, "link", "href") || tag(block, ["guid"]);
    if (!title || !link) continue;

    entries.push({
      title,
      url: link,
      publishedAt: tag(block, ["pubDate", "published", "updated", "dc:date"]),
      excerpt: tag(block, ["description", "summary", "content:encoded", "content"])
    });
  }

  return entries;
}
