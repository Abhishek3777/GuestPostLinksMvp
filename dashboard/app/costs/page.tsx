import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCostData } from "@/services/costs.service";
import { isCollecting } from "@/services/costCollector.service";
import { CostDashboard } from "@/components/CostDashboard";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const data = await getCostData(isCollecting());
  return <CostDashboard data={data} />;
}
