"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarNav } from "@/components/admin/sidebar-nav";

/**
 * Hamburger trigger + slide-in drawer for small screens. Radix Dialog (via
 * the Sheet primitive) provides the accessible behavior for free: focus
 * trap while open, Escape closes it, and focus returns to the trigger on
 * close — this is the "accessible keyboard/navigation behavior"
 * requirement for the mobile nav specifically.
 */
export function MobileNav({ companyName }: { companyName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{companyName}</SheetTitle>
        </SheetHeader>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
