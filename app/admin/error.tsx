"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Last-resort safety net for the Admin section. Individual dashboard
// sections already catch their own query failures and render an inline
// error (see lib/data/dashboard.ts's DataResult pattern) — this only
// fires for something unexpected outside that (e.g. a render crash), and
// never shows the raw error to the user (SECURITY_PLAN.md §12).
export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged to the browser console only; a real error-tracking integration
    // (Sentry or similar) is a future addition, not invented here.
    console.error("Admin section error");
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            This page couldn&apos;t load. You can try again, or use the sidebar to go
            elsewhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}
