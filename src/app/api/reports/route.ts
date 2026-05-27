import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractReport } from "@/lib/ai";
import { notifyTeamsHighRisk } from "@/lib/m365";
import type { Category, Severity, Likelihood } from "@/generated/prisma/client";

// POST /api/reports
// Body: { rawText: string, action: "extract" | "confirm", extraction?: {...} }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rawText, action, extraction } = body as {
    rawText: string;
    action: "extract" | "confirm";
    extraction?: {
      title: string;
      description: string;
      category: string;
      severity: string;
      likelihood: string;
      occurredAt: string;
      isAnonymous: boolean;
    };
  };

  if (!rawText || typeof rawText !== "string" || rawText.trim().length === 0) {
    return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  }

  // Step 1: AI extraction — return preview, do not save yet
  if (action === "extract") {
    const result = await extractReport(rawText);
    return NextResponse.json({ extraction: result });
  }

  // Step 2: User confirmed — save to DB
  if (action === "confirm" && extraction) {
    const report = await db.report.create({
      data: {
        rawText,
        title: extraction.title,
        description: extraction.description,
        category: extraction.category as Category,
        severity: extraction.severity as Severity,
        likelihood: extraction.likelihood as Likelihood,
        occurredAt: new Date(extraction.occurredAt),
        isAnonymous: extraction.isAnonymous,
        aiAnalysis: JSON.stringify({}),
      },
    });

    // Fire-and-forget Teams notification for high / critical reports
    notifyTeamsHighRisk(report).catch(() => undefined);

    return NextResponse.json({ report }, { status: 201 });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// GET /api/reports — list all reports
export async function GET() {
  const reports = await db.report.findMany({
    orderBy: { createdAt: "desc" },
    include: { diagnosis: { select: { id: true } } },
  });
  return NextResponse.json({ reports });
}
