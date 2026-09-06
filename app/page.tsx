import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Temporary placeholder home page for Phase 1 (Project Setup).
// The real public site (Home/About/Programs/Contact/etc.) ships in Phase 22
// and will read all branding from centralized Company Settings rather than
// hard-coding "Roicians Tech" here.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Roicians Tech</CardTitle>
          <CardDescription>Training Management System / LMS</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            The public site, Admin Portal, Trainer Portal, and Student Portal are being
            built module by module — see{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
              IMPLEMENTATION_PLAN.md
            </code>{" "}
            for the current phase.
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <a href="/login/student" className="underline">
              Student Login
            </a>
            <a href="/login/trainer" className="underline">
              Trainer Login
            </a>
            <a href="/login/admin" className="underline">
              Admin Login
            </a>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
