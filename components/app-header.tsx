import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 sm:max-w-6xl">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-xs font-extrabold">DR</span>
          </div>
          <div>
            <p className="text-sm font-bold leading-none">Delivery Route</p>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">Scanner</p>
          </div>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}