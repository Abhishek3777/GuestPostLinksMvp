// Runs once when the server starts. Keeps the cost dashboard's data fresh
// (Railway usage + prepaid balances) without anyone having to open the page.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.RAILWAY_API_TOKEN && !process.env.TWO_CAPTCHA_API_KEY && !process.env.CAPSOLVER_API_KEY) return;

  const { collectCosts } = await import("./services/costCollector.service");
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  // Small delay so startup isn't competing with the first page loads.
  setTimeout(() => void collectCosts(), 30_000);
  setInterval(() => void collectCosts(), SIX_HOURS).unref();
}
