"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Home, List, MapPinned, Navigation2, Route, Settings, SkipForward } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RemainingRouteWidget } from "@/components/remaining-route-widget";
import { buildAppleMapsDirectionsUrl, buildFlitsmeisterDirectionsUrl, buildGoogleMapsDirectionsUrl } from "@/lib/route";
import { useRouteStore } from "@/store/use-route-store";

const LiveRouteMap = dynamic(
  () => import("@/components/live-route-map").then((module) => module.LiveRouteMap),
  { ssr: false },
);

export default function NavigationPage() {
  const router = useRouter();
  const { stops, currentStopIndex, setCurrentStopIndex, markDelivered } = useRouteStore();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileMapOpen, setMobileMapOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(true);
  const [activeTab, setActiveTab] = useState<number | null>(null);

  useEffect(() => {
    if (mobileSheetOpen) setActiveTab(1);
    else if (mobileMapOpen) setActiveTab(2);
    else if (mobileSettingsOpen) setActiveTab(3);
    else setActiveTab(null);
  }, [mobileSheetOpen, mobileMapOpen, mobileSettingsOpen]);

  const currentStop = stops[currentStopIndex];
  const completedCount = useMemo(
    () => stops.filter((stop) => stop.delivered).length,
    [stops],
  );
  const progress = stops.length ? Math.round((completedCount / stops.length) * 100) : 0;

  const openAppleMaps = () => window.open(buildAppleMapsDirectionsUrl(currentStop), "_blank", "noopener,noreferrer");
  const openFlitsmeister = () => window.location.href = buildFlitsmeisterDirectionsUrl(currentStop);

  const goToNextStop = () => {
    if (currentStopIndex < stops.length - 1) {
      setCurrentStopIndex(currentStopIndex + 1);
      return;
    }

    toast.success("You are at the last stop.");
  };

  const skipStop = () => {
    if (currentStopIndex < stops.length - 1) {
      setCurrentStopIndex(currentStopIndex + 1);
      toast.message("Stop skipped.");
      return;
    }

    toast.message("No more stops to skip.");
  };

  const markCurrentStopDelivered = () => {
    markDelivered(currentStop.id, true);

    if (currentStopIndex < stops.length - 1) {
      setCurrentStopIndex(currentStopIndex + 1);
      return;
    }

    toast.success("All stops delivered.");
    router.push("/");
  };

  if (stops.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto flex w-full max-w-md px-3 py-4 sm:max-w-3xl sm:px-4 sm:py-5">
          <Card className="w-full rounded-3xl shadow-sm">
            <CardHeader>
              <CardTitle>No route available</CardTitle>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push("/")}>Go to scanner</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Hero banner */}
      <div className="bg-[linear-gradient(135deg,oklch(0.42_0.26_262),oklch(0.55_0.22_280))] px-4 py-7 text-white">
        <div className="mx-auto flex max-w-md items-end justify-between gap-4 sm:max-w-6xl">
          <div>
            <p className="animate-fade-in-up mb-1 text-xs font-medium uppercase tracking-wider opacity-70">Step 3 of 3</p>
            <h1 className="animate-fade-in-up delay-75 text-2xl font-bold tracking-tight sm:text-3xl">Navigation</h1>
            <p className="animate-fade-in-up delay-150 mt-0.5 text-sm text-white/75">Delivering stop by stop.</p>
          </div>
          <div className="animate-scale-in delay-150 text-right shrink-0">
            <p className="text-3xl font-extrabold tabular-nums">
              {completedCount}<span className="text-lg opacity-60">/{stops.length}</span>
            </p>
            <p className="text-xs text-white/70">delivered</p>
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-4 pb-[calc(180px+env(safe-area-inset-bottom))] sm:max-w-6xl sm:grid sm:grid-cols-[minmax(0,1fr)_340px] sm:gap-5 sm:space-y-0 sm:pb-5">
        <section className="min-h-0 space-y-3 sm:space-y-4">
          {/* Current stop */}
          <Card className="animate-fade-in-up delay-300 overflow-hidden rounded-2xl border-0 bg-transparent py-0 shadow-none ring-0 sm:border sm:bg-card sm:py-4 sm:shadow-sm sm:ring-1">
            <div className="rounded-2xl bg-primary px-4 pt-3 pb-4 text-primary-foreground sm:rounded-b-none">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider opacity-70">Current stop</p>
                <Badge className="border-0 bg-white/20 text-xs text-white">{currentStopIndex + 1} / {stops.length}</Badge>
              </div>
              <p className="mt-2 text-2xl font-bold leading-tight">{currentStop.street} {currentStop.houseNumber}</p>
              <p className="text-base text-white/80">{currentStop.postalCode} {currentStop.city}</p>
            </div>
            <CardContent className="hidden space-y-3 p-4 sm:block">
              <div className="hidden grid-cols-2 gap-2 sm:grid">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-xl text-sm font-semibold gap-2"
                  onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank")}
                >
                  <MapPinned className="size-4" /> Map
                </Button>
              </div>

              <Button
                size="lg"
                className="hidden h-12 w-full rounded-xl text-sm font-semibold gap-2 sm:flex"
                onClick={markCurrentStopDelivered}
              >
                <CheckCircle2 className="size-4" /> Mark delivered
              </Button>

              <Button
                size="lg"
                variant="secondary"
                className="hidden h-12 w-full rounded-xl text-sm font-semibold gap-2 sm:flex"
                onClick={skipStop}
              >
                <SkipForward className="size-4" /> Skip stop
              </Button>

              <div className="hidden grid-cols-2 gap-2 sm:grid">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl"
                  onClick={() => setCurrentStopIndex(Math.max(0, currentStopIndex - 1))}
                  disabled={currentStopIndex === 0}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <Button variant="outline" className="h-10 rounded-xl" onClick={goToNextStop}>
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="animate-fade-in-up">
            <LiveRouteMap stop={currentStop} />
          </div>

          <div className="animate-fade-in-up delay-75">
            <RemainingRouteWidget stops={stops} currentStopIndex={currentStopIndex} />
          </div>

          {/* Progress */}
          <div className="animate-fade-in-up delay-225 space-y-2 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <p className="font-semibold">Deliveries completed</p>
              <p className="text-primary font-bold tabular-nums">{completedCount}/{stops.length}</p>
            </div>
            <Progress value={progress} className="h-2.5" />
          </div>

          <div className="animate-fade-in-up delay-300 flex justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="secondary"
                    className="h-11 rounded-full border border-white/40 bg-white/70 px-4 text-sm font-semibold shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-black/40"
                  />
                }
              >
                <Navigation2 className="size-4" /> Open in map app
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem onClick={() => window.open(buildGoogleMapsDirectionsUrl([currentStop]), "_blank", "noopener,noreferrer")}>Google Maps</DropdownMenuItem>
                <DropdownMenuItem onClick={openAppleMaps}>Apple Maps</DropdownMenuItem>
                <DropdownMenuItem onClick={openFlitsmeister}>Flitsmeister</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

        </section>

        <aside className="hidden sm:block">
          <div className="sticky top-20 space-y-3">
            <Card className="rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-primary px-4 pt-3 pb-3 text-primary-foreground">
                <p className="text-xs font-medium uppercase tracking-wider opacity-70">All stops</p>
                <p className="text-sm font-semibold mt-0.5 opacity-90">{completedCount} of {stops.length} delivered</p>
              </div>
              <CardContent className="p-3">
                <Button
                  className="h-9 w-full rounded-xl mb-3"
                  variant="outline"
                  onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank")}
                >
                  <Route className="size-4" /> Open full route
                </Button>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1.5 pr-1">
                    {stops.map((stop, index) => (
                      <Button
                        variant="ghost"
                        key={stop.id}
                        onClick={() => setCurrentStopIndex(index)}
                        className={`h-auto w-full justify-start rounded-xl px-2 py-2 text-left transition-colors ${
                          index === currentStopIndex
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-muted/40"
                        } ${stop.delivered ? "opacity-50" : ""}`}
                      >
                        <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          stop.delivered ? "bg-muted text-muted-foreground" :
                          index === currentStopIndex ? "bg-primary text-primary-foreground" :
                          "bg-primary/10 text-primary"
                        }`}>
                          {stop.delivered ? <CheckCircle2 className="size-3.5" /> : index + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight">{stop.street} {stop.houseNumber}</p>
                          <p className="text-xs text-muted-foreground">{stop.postalCode} {stop.city}</p>
                        </div>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </aside>
      </main>

      <div className="fixed right-0 left-0 z-40 sm:hidden bottom-[calc(92px+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md px-4">
          <div className="rounded-2xl border border-white/40 bg-white/60 p-2 shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-black/35">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11 rounded-xl" onClick={skipStop}>
                <SkipForward className="size-4" /> Skip stop
              </Button>
              <Button
                className="h-11 rounded-xl"
                onClick={markCurrentStopDelivered}
              >
                <CheckCircle2 className="size-4" /> Mark done
              </Button>
            </div>
          </div>
        </div>
      </div>



      <div className="fixed right-0 bottom-0 left-0 z-50 sm:hidden">
        <div className="mx-auto max-w-md px-4 pb-[calc(10px+env(safe-area-inset-bottom))]">
          <div className="rounded-[2rem] border border-white/40 bg-white/55 p-2 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-black/35">
            <div className="relative flex items-stretch">
              {/* Sliding pill indicator */}
              <div
                className="pointer-events-none absolute inset-y-0 w-1/4 rounded-[1.2rem] bg-white/80 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] dark:bg-white/20"
                style={{
                  transform: activeTab !== null ? `translateX(${activeTab * 100}%)` : "translateX(-110%)",
                  opacity: activeTab !== null ? 1 : 0,
                  transition: "transform 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 150ms ease",
                }}
              />
              <Button
                variant="ghost"
                className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80 transition-colors"
                onClick={() => router.push("/")}
              >
                <Home className="size-5" />
                Home
              </Button>

              <Dialog open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
                <DialogTrigger render={<Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80 transition-colors" />}>
                  <List className="size-5" />
                  Stops
                </DialogTrigger>
                <DialogContent className="top-auto right-0 bottom-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-t-[2rem] rounded-b-none border-white/40 bg-background/95 sm:max-w-none">
                  <DialogHeader>
                    <DialogTitle>All stops</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[52vh]">
                    <div className="space-y-1.5 p-1 pr-2">
                      {stops.map((stop, index) => (
                        <Button
                          variant="ghost"
                          key={stop.id}
                          className={`h-auto w-full justify-start rounded-xl px-2 py-2 text-left transition-colors ${
                            index === currentStopIndex ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/40"
                          } ${stop.delivered ? "opacity-50" : ""}`}
                          onClick={() => {
                            setCurrentStopIndex(index);
                            setMobileSheetOpen(false);
                          }}
                        >
                          <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            stop.delivered ? "bg-muted text-muted-foreground" :
                            index === currentStopIndex ? "bg-primary text-primary-foreground" :
                            "bg-primary/10 text-primary"
                          }`}>
                            {stop.delivered ? <CheckCircle2 className="size-3.5" /> : index + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold leading-tight">{stop.street} {stop.houseNumber}</p>
                            <p className="text-xs text-muted-foreground">{stop.postalCode} {stop.city}</p>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <Dialog open={mobileMapOpen} onOpenChange={setMobileMapOpen}>
                <DialogTrigger render={<Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80 transition-colors" />}>
                  <MapPinned className="size-5" />
                  Map
                </DialogTrigger>
                <DialogContent className="top-auto right-0 bottom-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-t-[2rem] rounded-b-none border-white/40 bg-background/95 sm:max-w-none">
                  <DialogHeader>
                    <DialogTitle>Live map</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <LiveRouteMap stop={currentStop} />
                    <Button
                      className="h-11 rounded-xl"
                      onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank")}
                    >
                      <Route className="size-4" /> Full route
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
                <DialogTrigger render={<Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80 transition-colors" />}>
                  <Settings className="size-5" />
                  Settings
                </DialogTrigger>
                <DialogContent className="top-auto right-0 bottom-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-t-[2rem] rounded-b-none border-white/40 bg-background/95 sm:max-w-none">
                  <DialogHeader>
                    <DialogTitle>Quick settings</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Card className="rounded-2xl shadow-sm">
                      <CardContent className="space-y-2 p-4">
                        <p className="text-sm font-semibold">Quick mode</p>
                        <p className="text-xs text-muted-foreground">Keeps the screen focused on the current stop and bottom dock.</p>
                        <Button
                          variant={quickMode ? "default" : "outline"}
                          className="h-10 rounded-xl"
                          onClick={() => setQuickMode((value) => !value)}
                        >
                          {quickMode ? "Enabled" : "Disabled"}
                        </Button>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="h-11 rounded-xl" onClick={() => router.push("/") }>
                        <Home className="size-4" /> Home
                      </Button>
                      <Button variant="outline" className="h-11 rounded-xl" onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank") }>
                        <Route className="size-4" /> Open route
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}