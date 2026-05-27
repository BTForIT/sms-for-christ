import { db } from "../lib/db";
import { generateInsights } from "../../src/lib/ai";

export async function getInsights() {
  const reports = await db.report.findMany({
    select: {
      category: true,
      severity: true,
      likelihood: true,
      occurredAt: true,
      title: true,
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  const summaries = reports.map((r) => ({
    category: r.category,
    severity: r.severity,
    likelihood: r.likelihood,
    occurredAt: r.occurredAt.toISOString().split("T")[0],
    title: r.title,
  }));

  return generateInsights(summaries);
}
