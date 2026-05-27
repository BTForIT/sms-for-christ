import { db } from "../lib/db";

const SEVERITY_SCORE: Record<string, number> = {
  Negligible: 1, Minor: 2, Major: 3, Hazardous: 4, Catastrophic: 5,
};
const LIKELIHOOD_SCORE: Record<string, number> = {
  ExtremelyImprobable: 1, Improbable: 2, Remote: 3, Probable: 4, Frequent: 5,
};

function riskScore(severity: string, likelihood: string) {
  return (SEVERITY_SCORE[severity] ?? 1) * (LIKELIHOOD_SCORE[likelihood] ?? 1);
}

function riskLevel(score: number) {
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 16) return "high";
  return "critical";
}

export interface ListReportsArgs {
  category?: string;
  severity?: string;
  status?: string;
  limit?: number;
  include_diagnosis?: boolean;
}

export async function listReports(args: ListReportsArgs) {
  const { category, severity, status, limit = 20, include_diagnosis = false } = args;

  const reports = await db.report.findMany({
    where: {
      ...(category ? { category: category as never } : {}),
      ...(severity ? { severity: severity as never } : {}),
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    include: include_diagnosis ? { diagnosis: { include: { correctiveActions: true } } } : undefined,
  });

  return reports.map((r) => {
    const score = riskScore(r.severity, r.likelihood);
    return {
      ...r,
      riskScore: score,
      riskLevel: riskLevel(score),
    };
  });
}

export async function getReport(id: string) {
  const report = await db.report.findUnique({
    where: { id },
    include: {
      diagnosis: {
        include: { correctiveActions: true },
      },
    },
  });

  if (!report) return null;

  const score = riskScore(report.severity, report.likelihood);
  return {
    ...report,
    riskScore: score,
    riskLevel: riskLevel(score),
    aiAnalysis: (() => {
      try { return JSON.parse(report.aiAnalysis); } catch { return {}; }
    })(),
    diagnosis: report.diagnosis
      ? {
          ...report.diagnosis,
          rootCauses: (() => { try { return JSON.parse(report.diagnosis!.rootCauses); } catch { return []; } })(),
          fiveWhys: (() => { try { return JSON.parse(report.diagnosis!.fiveWhys); } catch { return []; } })(),
          similarEvents: (() => { try { return JSON.parse(report.diagnosis!.similarEvents); } catch { return []; } })(),
        }
      : null,
  };
}

export async function getRiskSummary() {
  const [reports, diagnoses, openActions, overdueActions] = await Promise.all([
    db.report.findMany({ select: { status: true, severity: true, likelihood: true } }),
    db.diagnosis.count(),
    db.correctiveAction.count({ where: { status: "Open" } }),
    db.correctiveAction.count({
      where: { status: "Open", dueDate: { lt: new Date() } },
    }),
  ]);

  const byRisk = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus = { Open: 0, UnderReview: 0, Closed: 0 };
  const byCategory: Record<string, number> = {};

  for (const r of reports) {
    const score = riskScore(r.severity, r.likelihood);
    const level = riskLevel(score) as keyof typeof byRisk;
    byRisk[level]++;
    byStatus[r.status as keyof typeof byStatus]++;
  }

  return {
    totalReports: reports.length,
    byStatus,
    byRisk,
    byCategory,
    diagnosesComplete: diagnoses,
    openActions,
    overdueActions,
  };
}
