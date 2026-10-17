import { ExternalLink } from "lucide-react";

// Opens the real site in a new tab, right next to the domain name in any
// results table — saves the copy-paste-into-address-bar round trip that was
// the single most repeated manual step when checking a domain by hand.
export function DomainLink({ domain }: { domain: string }) {
  return (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${domain}`}
      className="inline-flex shrink-0 items-center justify-center text-muted transition-colors hover:text-accent"
    >
      <ExternalLink size={13} />
    </a>
  );
}
