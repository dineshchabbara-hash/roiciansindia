import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StudentStatusBadge } from "@/components/admin/students/student-status-badge";
import { StudentStatusControl } from "@/components/admin/students/student-status-control";
import { StudentNotesSection } from "@/components/admin/students/student-notes-section";
import { StudentDocumentsSection } from "@/components/admin/students/student-documents-section";
import { StudentEnrollmentHistoryCard } from "@/components/admin/students/student-enrollment-history-card";
import { StudentPaymentHistoryCard } from "@/components/admin/students/student-payment-history-card";
import { StudentAttendanceHistoryCard } from "@/components/admin/students/student-attendance-history-card";
import { StudentCertificateHistoryCard } from "@/components/admin/students/student-certificate-history-card";
import {
  getStudentProfile,
  getStudentEnrollmentHistory,
  getStudentPaymentHistory,
  getStudentAttendanceHistory,
  getStudentCertificateHistory,
  getStudentNotes,
  getStudentDocuments,
} from "@/lib/data/students";

export const dynamic = "force-dynamic";

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

async function EnrollmentHistorySection({ studentId }: { studentId: string }) {
  const result = await getStudentEnrollmentHistory(studentId);
  return result.ok ? (
    <StudentEnrollmentHistoryCard data={result.data} />
  ) : (
    <StudentEnrollmentHistoryCard error={result.error} />
  );
}

async function PaymentHistorySection({ studentId }: { studentId: string }) {
  const result = await getStudentPaymentHistory(studentId);
  return result.ok ? (
    <StudentPaymentHistoryCard data={result.data} />
  ) : (
    <StudentPaymentHistoryCard error={result.error} />
  );
}

async function AttendanceHistorySection({ studentId }: { studentId: string }) {
  const result = await getStudentAttendanceHistory(studentId);
  return result.ok ? (
    <StudentAttendanceHistoryCard data={result.data} />
  ) : (
    <StudentAttendanceHistoryCard error={result.error} />
  );
}

async function CertificateHistorySection({ studentId }: { studentId: string }) {
  const result = await getStudentCertificateHistory(studentId);
  return result.ok ? (
    <StudentCertificateHistoryCard data={result.data} />
  ) : (
    <StudentCertificateHistoryCard error={result.error} />
  );
}

async function NotesSection({ studentId }: { studentId: string }) {
  const result = await getStudentNotes(studentId);
  return (
    <StudentNotesSection studentId={studentId} notes={result.ok ? result.data : []} />
  );
}

async function DocumentsSection({ studentId }: { studentId: string }) {
  const result = await getStudentDocuments(studentId);
  return (
    <StudentDocumentsSection
      studentId={studentId}
      documents={result.ok ? result.data : []}
    />
  );
}

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileResult = await getStudentProfile(id);

  if (!profileResult.ok) {
    notFound();
  }

  const student = profileResult.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {student.firstName} {student.lastName}
            </h1>
            <StudentStatusBadge status={student.status} />
          </div>
          <p className="text-muted-foreground font-mono text-sm">{student.studentCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <StudentStatusControl studentId={student.id} currentStatus={student.status} />
          <Button variant="outline" asChild>
            <Link href={`/admin/students/${student.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact & Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Phone</p>
            <p>{student.phone}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Alternate phone</p>
            <p>{student.alternatePhone ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{student.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Date of birth</p>
            <p>{student.dateOfBirth ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Gender</p>
            <p>{student.gender ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Registered</p>
            <p>{student.registrationDate}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Address</p>
            <p>
              {[
                student.addressLine1,
                student.addressLine2,
                student.city,
                student.state,
                student.postalCode,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Emergency contact</p>
            <p>
              {student.emergencyContactName
                ? `${student.emergencyContactName} (${student.emergencyContactPhone ?? "no phone"})`
                : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton />}>
          <EnrollmentHistorySection studentId={student.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <PaymentHistorySection studentId={student.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <AttendanceHistorySection studentId={student.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <CertificateHistorySection studentId={student.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <DocumentsSection studentId={student.id} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton />}>
          <NotesSection studentId={student.id} />
        </Suspense>
      </div>
    </div>
  );
}
