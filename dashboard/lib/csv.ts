// Accepts a loose domain list: plain domains, full URLs, an optional
// "domain" header row, or a CSV where the domain is just the first column.
export function parseDomainsCsv(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const dataLines = lines[0] && /^domain$/i.test(lines[0].split(",")[0]) ? lines.slice(1) : lines;

  const domains = dataLines.map((line) => {
    const firstField = line.split(",")[0].trim();
    try {
      const url = new URL(firstField.includes("://") ? firstField : `https://${firstField}`);
      return url.hostname.replace(/^www\./, "");
    } catch {
      return firstField.replace(/^www\./, "");
    }
  });

  return [...new Set(domains.filter(Boolean))];
}

// Pasted/typed domains: separated by newlines, commas, semicolons or spaces.
export function parseDomainsText(text: string): string[] {
  return parseDomainsCsv(text.replace(/[,;\s]+/g, "\n"));
}
