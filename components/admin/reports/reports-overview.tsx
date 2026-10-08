import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimalAsINR } from "@/lib/domain/money";
import {
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  formatRatioPercent,
  paiseToDecimalString,
} from "@/lib/domain/reports";

export type ReportsOverviewData = {
  students: { total: number; active: number } | null;
  enrollments: {
    confirmed: number;
    pipeline: number;
    cancelledOrWithdrawn: number;
  } | null;
  finance: { revenueCollectedPaise: number; confirmedUnpaidFeesPaise: number } | null;
  attendance: { marked: number; presentOrLate: number } | null;
  certificates: { issued: number; revoked: number } | null;
};

const UNAVAILABLE = "Could not load these figures.";

function Figures({ items }: { items: Array<[string, string]> | null }) {
  if (!items) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {UNAVAILABLE}
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function inr(paise: number): string {
  return formatDecimalAsINR(paiseToDecimalString(paise));
}

/**
 * Small analytics summary (no chart library): simple counts per area, each
 * from an existing authoritative source — Students/Enrollments/money from
 * the dashboard's own functions, attendance/certificates from head counts.
 */
export function ReportsOverview({ data }: { data: ReportsOverviewData }) {
  const { students, enrollments, finance, attendance, certificates } = data;
  const sections: Array<{ title: string; items: Array<[string, string]> | null }> = [
    {
      title: "Students",
      items: students && [
        ["Total", String(students.total)],
        ["Active", String(students.active)],
      ],
    },
    {
      title: "Enrollments",
      items: enrollments && [
        ["Confirmed", String(enrollments.confirmed)],
        ["Pipeline", String(enrollments.pipeline)],
        ["Cancelled or withdrawn", String(enrollments.cancelledOrWithdrawn)],
      ],
    },
    {
      title: "Finance",
      items: finance && [
        ["Revenue collected", inr(finance.revenueCollectedPaise)],
        ["Confirmed unpaid fees", inr(finance.confirmedUnpaidFeesPaise)],
      ],
    },
    {
      title: "Attendance",
      items: attendance && [
        ["Sessions marked", String(attendance.marked)],
        ["Present or late", String(attendance.presentOrLate)],
        [
          "Overall attendance",
          (() => {
            const rate = formatRatioPercent(attendance.presentOrLate, attendance.marked);
            return rate === null ? "—" : `${rate}%`;
          })(),
        ],
      ],
    },
    {
      title: "Certificates",
      items: certificates && [
        ["Issued", String(certificates.issued)],
        ["Revoked", String(certificates.revoked)],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="reports-summary-heading" className="flex flex-col gap-3">
        <h2 id="reports-summary-heading" className="text-lg font-semibold">
          Summary
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {sections.map((section) => (
            <Card key={section.title} aria-label={`${section.title} summary`}>
              <CardHeader>
                <CardTitle asChild>
                  <h3 className="text-sm font-medium">{section.title}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Figures items={section.items} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="reports-list-heading" className="flex flex-col gap-3">
        <h2 id="reports-list-heading" className="text-lg font-semibold">
          Reports
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_KINDS.map((kind) => {
            const def = REPORT_DEFINITIONS[kind];
            return (
              <li key={kind}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle asChild>
                      <h3 className="text-base">
                        <Link href={`/admin/reports/${kind}`} className="hover:underline">
                          {def.title}
                        </Link>
                      </h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground text-sm">{def.description}</p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
