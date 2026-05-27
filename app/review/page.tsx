"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Home,
  List,
  MapPinned,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Route,
  Navigation,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { formatAddress, hasMissingFields, normalizeStop, parseAddressesFromOcrText, toStops } from "@/lib/address";
import { buildGoogleMapsDirectionsUrl, duplicateKeys, optimizeByNearestNeighbor } from "@/lib/route";
import { useRouteStore } from "@/store/use-route-store";
import { AddressStop } from "@/types/route";
import { Switch } from "@/components/ui/switch";

const PAGE_SIZE = 20;

function SortableRow({
  stop,
  index,
  duplicate,
  onEdit,
  onDelete,
}: {
  stop: AddressStop;
  index: number;
  duplicate: boolean;
  onEdit: (stop: AddressStop) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="animate-fade-in-up flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5 transition-shadow hover:shadow-sm"
    >
      {/* Drag handle */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Drag stop"
        className="size-7 shrink-0 cursor-grab text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </Button>

      {/* Numbered circle */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {index + 1}
      </div>

      {/* Address */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{stop.street} {stop.houseNumber}</p>
        <p className="text-xs text-muted-foreground">{stop.postalCode} {stop.city}</p>
        {duplicate ? <Badge variant="destructive" className="mt-1 text-[10px]">Duplicate</Badge> : null}
        {hasMissingFields(stop) ? <Badge variant="outline" className="mt-1 text-[10px]">Needs check</Badge> : null}
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="Open actions" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(stop)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(buildGoogleMapsDirectionsUrl([stop]), "_blank")}>
            <Navigation /> Navigate
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(stop.id)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const {
    rawText,
    stops,
    optimizeAutomatically,
    setOptimizeAutomatically,
    setStops,
    updateStop,
    deleteStop,
    reorderStops,
    addStop,
    setRawText,
  } = useRouteStore();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [editableRaw, setEditableRaw] = useState(rawText);
  const [skipMissingHouseNumber, setSkipMissingHouseNumber] = useState(false);
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<AddressStop | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const duplicates = useMemo(() => duplicateKeys(stops), [stops]);

  const pageCount = Math.max(1, Math.ceil(stops.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageStops = stops.slice(pageStart, pageStart + PAGE_SIZE);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = stops.findIndex((stop) => stop.id === active.id);
    const to = stops.findIndex((stop) => stop.id === over.id);
    if (from < 0 || to < 0) return;

    reorderStops(from, to);
  };

  const handleGenerateRoute = () => {
    let finalStops = [...stops];

    if (skipMissingHouseNumber) {
      finalStops = finalStops.filter((stop) => stop.houseNumber.trim().length > 0);
    }

    if (optimizeAutomatically) {
      finalStops = optimizeByNearestNeighbor(finalStops);
    }

    if (finalStops.length === 0) {
      toast.error("No valid stops left to route.");
      return;
    }

    setStops(finalStops);
    toast.success("Route generated.");
    router.push("/navigation");
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Hero banner */}
      <div className="bg-[linear-gradient(135deg,oklch(0.42_0.26_262),oklch(0.55_0.22_280))] px-4 py-8 text-white">
        <div className="mx-auto max-w-md sm:max-w-6xl flex items-end justify-between gap-4">
          <div>
            <p className="animate-fade-in-up text-xs font-medium uppercase tracking-wider opacity-70 mb-1">Step 2 of 3</p>
            <h1 className="animate-fade-in-up delay-75 text-2xl font-bold tracking-tight">Review stops</h1>
            <p className="animate-fade-in-up delay-150 text-sm text-white/75 mt-0.5">Edit, reorder and remove before navigating.</p>
          </div>
          <div className="animate-scale-in delay-150 text-right shrink-0">
            <p className="text-3xl font-extrabold tabular-nums">{stops.length}</p>
            <p className="text-xs text-white/70">stops detected</p>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md space-y-4 px-4 py-5 pb-[calc(120px+env(safe-area-inset-bottom))] sm:max-w-6xl sm:grid sm:grid-cols-[minmax(0,1fr)_320px] sm:gap-5 sm:space-y-0 sm:pb-5">
        <section className="space-y-4">

        <Card className="animate-fade-in-up delay-225 rounded-2xl shadow-sm">
          <CardContent className="p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Raw OCR text</p>
            <Textarea
              value={editableRaw}
              onChange={(event) => setEditableRaw(event.target.value)}
              rows={5}
              placeholder="OCR raw text"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRawText(editableRaw);
                  const reparsed = toStops(parseAddressesFromOcrText(editableRaw));
                  setStops(reparsed);
                  setPage(1);
                  toast.success(`Re-extracted ${reparsed.length} stops.`);
                }}
              >
                Re-extract from text
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  addStop({
                    street: "",
                    houseNumber: "",
                    postalCode: "",
                    city: "",
                    raw: "manual",
                  })
                }
              >
                <Plus /> Add stop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stops ({stops.length})</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={() => {
                  const unique = new Map<string, AddressStop>();
                  for (const stop of stops) {
                    const key = `${stop.street}|${stop.houseNumber}|${stop.postalCode}|${stop.city}`.toLowerCase();
                    if (!unique.has(key)) unique.set(key, stop);
                  }
                  setStops([...unique.values()]);
                  toast.success("Duplicates removed.");
                }}
              >
                Remove duplicates
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={skipMissingHouseNumber}
                onCheckedChange={(checked) => setSkipMissingHouseNumber(Boolean(checked))}
              />
              Skip stops with missing house number when generating route
            </label>

            <ScrollArea className="h-[440px] rounded-2xl border bg-muted/10 p-2 sm:h-[420px]">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pageStops.map((stop) => stop.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {pageStops.map((stop) => (
                      <SortableRow
                        key={stop.id}
                        stop={stop}
                        index={stops.findIndex((item) => item.id === stop.id)}
                        duplicate={duplicates.has(formatAddress(stop).toLowerCase())}
                        onEdit={(target) => setEditTarget(target)}
                        onDelete={(id) => {
                          deleteStop(id);
                          toast.success("Stop removed.");
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>

            <div className="flex items-center justify-between gap-2">
              <Button className="h-11 flex-1" variant="outline" onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</Button>
              <p className="text-sm text-muted-foreground">Page {page} / {pageCount}</p>
              <Button className="h-11 flex-1" variant="outline" onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}>Next</Button>
            </div>

            <div className="sticky bottom-0 grid gap-2 rounded-2xl border bg-background/95 p-2 backdrop-blur sm:static sm:grid-cols-2 sm:border-0 sm:p-0">
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-xl"
                onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank")}
                disabled={stops.length === 0}
              >
                <Navigation /> Open Google Maps
              </Button>
              <Button size="lg" className="h-12 rounded-xl" onClick={handleGenerateRoute}>
                <Route /> Generate Route
              </Button>
            </div>
          </CardContent>
        </Card>
        </section>

        <aside className="hidden sm:block">
          <div className="sticky top-20 space-y-3">
            <Card className="rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-primary px-4 pt-3 pb-4 text-primary-foreground">
                <p className="text-xs font-medium uppercase tracking-wider opacity-70">Route summary</p>
                <p className="text-2xl font-extrabold tabular-nums mt-0.5">{stops.length} <span className="text-base font-medium opacity-80">stops</span></p>
              </div>
              <CardContent className="p-3 space-y-2">
                <Button
                  className="h-10 w-full rounded-xl"
                  variant="outline"
                  onClick={() => window.open(buildGoogleMapsDirectionsUrl(stops), "_blank")}
                  disabled={stops.length === 0}
                >
                  <Navigation className="size-4" /> Open in Maps
                </Button>
                <Button className="h-10 w-full rounded-xl" onClick={handleGenerateRoute}>
                  <Route className="size-4" /> Start Navigation
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardContent className="p-3">
                <ScrollArea className="h-[380px]">
                  <div className="space-y-1.5 pr-1">
                    {stops.map((stop, index) => (
                      <div key={stop.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-muted/40 transition-colors">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight">{stop.street} {stop.houseNumber}</p>
                          <p className="text-xs text-muted-foreground">{stop.postalCode} {stop.city}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </aside>
      </main>

      {/* Apple glass dock */}
      <div className="fixed right-0 bottom-0 left-0 z-50 sm:hidden">
        <div className="mx-auto max-w-md px-4 pb-[calc(10px+env(safe-area-inset-bottom))]">
          <div className="rounded-[2rem] border border-white/40 bg-white/55 p-2 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-black/35">
            <div className="relative flex items-stretch">
              {/* Pill resting on Stops (index 1) */}
              <div
                className="pointer-events-none absolute inset-y-0 w-1/4 rounded-[1.2rem] bg-white/80 shadow-sm dark:bg-white/20"
                style={{ transform: "translateX(100%)" }}
              />
              <Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80" onClick={() => router.push("/")}>
                <Home className="size-5" />
                Home
              </Button>
              <Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80" onClick={() => router.push("/review")}>
                <List className="size-5" />
                Stops
              </Button>
              <Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80" onClick={() => router.push("/navigation")}>
                <MapPinned className="size-5" />
                Map
              </Button>
              <Button variant="ghost" className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-5" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings sheet */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="top-auto right-0 bottom-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-t-[2rem] rounded-b-none border-white/40 bg-background/95 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pb-[env(safe-area-inset-bottom)]">
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Route</p>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Auto-optimize route</p>
                    <p className="text-xs text-muted-foreground">Nearest-neighbor ordering</p>
                  </div>
                  <Switch checked={optimizeAutomatically} onCheckedChange={(v) => setOptimizeAutomatically(Boolean(v))} />
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => router.push("/")}>
                <Home className="size-4" /> Home
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => router.push("/navigation")}>
                <Navigation className="size-4" /> Navigate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit stop</DialogTitle>
            <DialogDescription>Correct OCR mistakes before generating the route.</DialogDescription>
          </DialogHeader>

          {editTarget ? (
            <div className="space-y-2">
              <Input
                value={editTarget.street}
                placeholder="Street"
                onChange={(event) => setEditTarget({ ...editTarget, street: event.target.value })}
              />
              <Input
                value={editTarget.houseNumber}
                placeholder="House number"
                onChange={(event) => setEditTarget({ ...editTarget, houseNumber: event.target.value })}
              />
              <Input
                value={editTarget.postalCode}
                placeholder="Postal code"
                onChange={(event) => setEditTarget({ ...editTarget, postalCode: event.target.value })}
              />
              <Input
                value={editTarget.city}
                placeholder="City"
                onChange={(event) => setEditTarget({ ...editTarget, city: event.target.value })}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editTarget) return;
                updateStop(editTarget.id, normalizeStop(editTarget));
                toast.success("Stop updated.");
                setEditTarget(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}