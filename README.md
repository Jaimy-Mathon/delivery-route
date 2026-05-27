# Delivery Route Scanner

Production-ready Next.js web app for delivery drivers to:

- capture or upload a delivery list photo,
- extract addresses with OCR,
- review/edit/reorder stops,
- generate an optimized route,
- navigate stop-by-stop with Google Maps launch support.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui components
- Tesseract.js OCR (client-side)
- Zustand (persisted local state for offline fallback)
- dnd-kit for drag-and-drop stop ordering

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

Production build:

```bash
npm run build
npm run start
```

## App flow

1. Home (`/`)
	- Camera capture (mobile) or gallery upload
	- Desktop drag-and-drop
	- Image preview
	- OCR scan with progress
2. Review (`/review`)
	- Editable extracted address list
	- Delete entries
	- Drag-and-drop reorder
	- Duplicate cleanup
	- Optional skipping of stops without house number
3. Navigation (`/navigation`)
	- Full-screen next-stop style controls
	- Big tap targets for one-handed use
	- Mark as delivered + auto-advance
	- In-app step list + Google Maps launch

## Notes

- OCR quality depends on image sharpness and lighting.
- Address parsing includes NL/EU style heuristics and supports manual correction.
- Route optimization uses a lightweight nearest-neighbor postal heuristic.
