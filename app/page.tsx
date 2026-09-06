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
        <CardContent className="text-muted-foreground text-sm">
          Project scaffold complete. The public site, Admin Portal, Trainer Portal, and
          Student Portal are being built module by module — see{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            IMPLEMENTATION_PLAN.md
          </code>{" "}
          for the current phase.
        </CardContent>
      </Card>
    </main>
  );
}
