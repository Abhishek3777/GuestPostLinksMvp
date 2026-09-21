import { fetchText } from "./httpClient.js";

const sites = process.argv.slice(2);
for (const d of sites) {
  const r = await fetchText(`https://${d}/`);
  console.log(
    d.padEnd(30),
    r.ok ? "OK     " : `FAIL:${r.errorReason}`.padEnd(13),
    String(r.status ?? "-").padEnd(4),
    r.usedFallback ? `[via ${r.usedFallback}]` : "",
    r.failureDetail ?? ""
  );
}
process.exit(0);
