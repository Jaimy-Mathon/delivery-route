"use client";

import { ChangeEvent, DragEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, List, Loader2, MapPinned, Home, Route, ScanSearch, Settings2, X } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseAddressesFromOcrText, toStops } from "@/lib/address";
import { optimizeByNearestNeighbor } from "@/lib/route";
import { useRouteStore } from "@/store/use-route-store";

type OcrVariant = {
  label: string;
  image: string;
  canvas: HTMLCanvasElement;
};

type OcrScanMode = "mixed" | "screen" | "handwriting";

type NativeTextBlock = {
  rawValue?: string;
  lines?: Array<{ rawValue?: string }>;
};

type TextDetectorInstance = {
  detect(input: ImageBitmapSource): Promise<NativeTextBlock[]>;
};

function computeOtsuThreshold(histogram: number[], totalPixels: number) {
  let sum = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    sum += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let i = 0; i < histogram.length; i += 1) {
    weightBackground += histogram[i];
    if (weightBackground === 0) continue;

    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += i * histogram[i];

    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const varianceBetween =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      threshold = i;
    }
  }

  return threshold;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createGrayscaleCanvas(source: HTMLCanvasElement) {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
    data[index] = luminance;
    data[index + 1] = luminance;
    data[index + 2] = luminance;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function computeSkewAngle(canvas: HTMLCanvasElement) {
  const grayscale = createGrayscaleCanvas(canvas);
  const ctx = grayscale.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const width = grayscale.width;
  const height = grayscale.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const sample = Math.max(2, Math.floor(Math.min(width, height) / 200));

  for (let y = sample; y < height - sample; y += sample) {
    for (let x = sample; x < width - sample; x += sample) {
      const index = (y * width + x) * 4;
      const left = data[index - 4];
      const right = data[index + 4];
      const up = data[index - width * 4];
      const down = data[index + width * 4];
      const gx = right - left;
      const gy = down - up;
      const magnitude = Math.abs(gx) + Math.abs(gy);
      if (magnitude < 40) continue;
      sumX += gx * magnitude;
      sumY += gy * magnitude;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const angle = Math.atan2(sumY / count, sumX / count) * (180 / Math.PI);
  return clamp(-angle, -5, 5);
}

function deskewCanvas(source: HTMLCanvasElement) {
  const angle = computeSkewAngle(source);
  if (Math.abs(angle) < 0.4) {
    return source;
  }

  const radians = (angle * Math.PI) / 180;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function applyAdaptiveContrast(source: HTMLCanvasElement) {
  const grayscale = createGrayscaleCanvas(source);
  const blurred = cloneCanvas(grayscale);
  const blurCtx = blurred.getContext("2d", { willReadFrequently: true });
  if (!blurCtx) {
    throw new Error("Canvas preprocessing is unavailable");
  }
  blurCtx.filter = "blur(16px)";
  blurCtx.drawImage(grayscale, 0, 0);
  blurCtx.filter = "none";

  const sourceCtx = grayscale.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const sourceData = sourceCtx.getImageData(0, 0, grayscale.width, grayscale.height);
  const blurredData = blurCtx.getImageData(0, 0, grayscale.width, grayscale.height);
  const output = sourceCtx.createImageData(grayscale.width, grayscale.height);

  for (let index = 0; index < sourceData.data.length; index += 4) {
    const value = sourceData.data[index];
    const background = blurredData.data[index];
    const corrected = clamp(Math.round((value - background) * 1.4 + 128), 0, 255);
    output.data[index] = corrected;
    output.data[index + 1] = corrected;
    output.data[index + 2] = corrected;
    output.data[index + 3] = 255;
  }

  sourceCtx.putImageData(output, 0, 0);
  return grayscale;
}

function reduceNoise(source: HTMLCanvasElement) {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const copy = new Uint8ClampedArray(data);
  const width = canvas.width;
  const height = canvas.height;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const neighbors = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const offset = ((y + dy) * width + (x + dx)) * 4;
          neighbors.push(copy[offset]);
        }
      }
      neighbors.sort((a, b) => a - b);
      const median = neighbors[4];
      const offset = (y * width + x) * 4;
      data[offset] = median;
      data[offset + 1] = median;
      data[offset + 2] = median;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function sharpenCanvas(source: HTMLCanvasElement) {
  const original = createGrayscaleCanvas(source);
  const blurred = cloneCanvas(original);
  const blurCtx = blurred.getContext("2d", { willReadFrequently: true });
  if (!blurCtx) {
    throw new Error("Canvas preprocessing is unavailable");
  }
  blurCtx.filter = "blur(2px)";
  blurCtx.drawImage(original, 0, 0);
  blurCtx.filter = "none";

  const ctx = original.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const originalData = ctx.getImageData(0, 0, original.width, original.height);
  const blurredData = blurCtx.getImageData(0, 0, original.width, original.height);

  for (let index = 0; index < originalData.data.length; index += 4) {
    const sharpened = clamp(Math.round(originalData.data[index] * 1.6 - blurredData.data[index] * 0.6), 0, 255);
    originalData.data[index] = sharpened;
    originalData.data[index + 1] = sharpened;
    originalData.data[index + 2] = sharpened;
  }
  ctx.putImageData(originalData, 0, 0);
  return original;
}

function buildTextSegmentationCanvas(source: HTMLCanvasElement) {
  const grayscale = createGrayscaleCanvas(source);
  const ctx = grayscale.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const width = grayscale.width;
  const height = grayscale.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const rowSums = new Uint32Array(height);

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rowSum += 255 - imageData.data[index];
    }
    rowSums[y] = rowSum;
  }

  const threshold = width * 25;
  const segments: Array<[number, number]> = [];
  let start: number | null = null;

  for (let y = 0; y < height; y += 1) {
    const hasText = rowSums[y] > threshold;
    if (hasText && start === null) {
      start = y;
    } else if (!hasText && start !== null) {
      segments.push([start, y]);
      start = null;
    }
  }
  if (start !== null) {
    segments.push([start, height]);
  }

  if (segments.length <= 1) {
    return grayscale;
  }

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) {
    throw new Error("Canvas preprocessing is unavailable");
  }
  outputCtx.fillStyle = "white";
  outputCtx.fillRect(0, 0, width, height);

  for (const [segmentStart, segmentEnd] of segments) {
    const segmentHeight = Math.max(1, segmentEnd - segmentStart);
    const segmentData = ctx.getImageData(0, segmentStart, width, segmentHeight);
    outputCtx.putImageData(segmentData, 0, segmentStart);
  }

  return output;
}

function normalizeRecognizedText(text: string) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();

  return normalized.length > 0 ? normalized : "GEEN TEKST GEVONDEN";
}

function normalizeSymbolConfidenceText(text: string, symbols: Array<{ text: string; confidence?: number }>) {
  if (!symbols.length) {
    return normalizeRecognizedText(text);
  }

  let output = "";
  let position = 0;

  for (const symbol of symbols) {
    const character = symbol.text ?? "";
    const confidence = symbol.confidence ?? 0;
    if (!character) continue;
    if (confidence < 60 && /[A-Za-z0-9]/.test(character)) {
      output += "?";
    } else {
      output += character;
    }
    position += 1;
  }

  if (output.length === 0) {
    return "GEEN TEKST GEVONDEN";
  }

  return normalizeRecognizedText(output);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load selected image"));
    };
    image.src = objectUrl;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/png");
}

function cloneCanvas(source: HTMLCanvasElement) {
  const next = document.createElement("canvas");
  next.width = source.width;
  next.height = source.height;
  const nextContext = next.getContext("2d");
  if (!nextContext) {
    throw new Error("Canvas cloning is unavailable");
  }
  nextContext.drawImage(source, 0, 0);
  return next;
}

function scoreOcrText(rawText: string, confidence: number) {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (text.length < 4) return -1000;

  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const weird = (text.match(/[^A-Za-z0-9\s,./'\-]/g) ?? []).length;
  const hasPostalLike = /\b\d{4}\s?[A-Za-z]{2}\b/.test(text);
  const hasHouseLike = /\b\d+[A-Za-z]?\b/.test(text);

  let score = confidence * 1.4 + alnum - weird * 5;
  if (hasPostalLike) score += 22;
  if (hasHouseLike) score += 12;

  return score;
}

function createNativeTextDetector(): TextDetectorInstance | null {
  const textDetectorConstructor = (
    globalThis as typeof globalThis & { TextDetector?: new () => TextDetectorInstance }
  ).TextDetector;

  if (!textDetectorConstructor) {
    return null;
  }

  return new textDetectorConstructor();
}

function extractNativeBlockText(blocks: NativeTextBlock[]) {
  return blocks
    .map((block) => {
      if (block.rawValue) {
        return block.rawValue;
      }

      if (block.lines?.length) {
        return block.lines.map((line) => line.rawValue ?? "").join("\n");
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getOcrProfile(mode: OcrScanMode, psm: typeof import("tesseract.js").PSM) {
  if (mode === "screen") {
    return {
      scanModes: [psm.SINGLE_BLOCK, psm.AUTO],
      workerParams: {
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_char_whitelist:
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -/,.'",
      },
    };
  }

  if (mode === "handwriting") {
    return {
      scanModes: [psm.SPARSE_TEXT, psm.AUTO, psm.SINGLE_LINE],
      workerParams: {
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      },
    };
  }

  return {
    scanModes: [psm.SPARSE_TEXT, psm.AUTO, psm.SINGLE_BLOCK],
    workerParams: {
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    },
  };
}

async function buildOcrVariants(file: File): Promise<OcrVariant[]> {
  const image = await loadImage(file);
  const longestSide = Math.max(image.width, image.height);
  const targetLongestSide = Math.max(longestSide, 1800);
  const scale = Math.min(2.5, targetLongestSide / longestSide);

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = Math.max(1, Math.round(image.width * scale));
  baseCanvas.height = Math.max(1, Math.round(image.height * scale));

  const baseContext = baseCanvas.getContext("2d");
  if (!baseContext) {
    throw new Error("Canvas preprocessing is unavailable");
  }
  baseContext.drawImage(image, 0, 0, baseCanvas.width, baseCanvas.height);

  const deskewed = deskewCanvas(baseCanvas);
  const normalized = applyAdaptiveContrast(deskewed);
  const denoised = reduceNoise(normalized);
  const sharpened = sharpenCanvas(denoised);
  const binaryCanvas = cloneCanvas(sharpened);
  const binaryContext = binaryCanvas.getContext("2d", { willReadFrequently: true });
  if (!binaryContext) {
    throw new Error("Canvas preprocessing is unavailable");
  }

  const imageData = binaryContext.getImageData(0, 0, binaryCanvas.width, binaryCanvas.height);
  const { data } = imageData;
  const histogram = new Array<number>(256).fill(0);
  const grayscale = new Uint8Array(data.length / 4);
  let sumLuminance = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    grayscale[index / 4] = luminance;
    histogram[luminance] += 1;
    sumLuminance += luminance;
  }

  const threshold = computeOtsuThreshold(histogram, grayscale.length);
  const meanLuminance = sumLuminance / grayscale.length;
  const invert = meanLuminance < 120;

  for (let index = 0; index < data.length; index += 4) {
    const value = grayscale[index / 4];
    const isTextPixel = invert ? value > threshold : value < threshold;
    const output = isTextPixel ? 0 : 255;
    data[index] = output;
    data[index + 1] = output;
    data[index + 2] = output;
    data[index + 3] = 255;
  }

  binaryContext.putImageData(imageData, 0, 0);

  const segmented = buildTextSegmentationCanvas(sharpened);

  return [
    { label: "original", image: canvasToPng(baseCanvas), canvas: baseCanvas },
    { label: "enhanced", image: canvasToPng(sharpened), canvas: sharpened },
    { label: "binary", image: canvasToPng(binaryCanvas), canvas: binaryCanvas },
    { label: "segmented", image: canvasToPng(segmented), canvas: segmented },
  ];
}

export default function HomePage() {
  const router = useRouter();
  const {
    optimizeAutomatically,
    setImagePreview,
    setOptimizeAutomatically,
    setRawText,
    setStops,
    setCurrentStopIndex,
  } = useRouteStore();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrScanMode, setOcrScanMode] = useState<OcrScanMode>("mixed");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferEasyOcr, setPreferEasyOcr] = useState(false);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Invalid file result"));
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleFileSelection = async (files: File[]) => {
    if (files.length === 0) return;

    const validImages = files.filter((file) => file.type.startsWith("image/"));
    if (validImages.length === 0) {
      toast.error("Please upload a valid image file.");
      return;
    }

    const previews = await Promise.all(validImages.map((file) => fileToDataUrl(file)));
    setSelectedFiles((prev) => [...prev, ...validImages]);
    setPreviewImages((prev) => [...prev, ...previews]);
    // Only set the store preview when adding the very first image
    if (previewImages.length === 0 && previews.length > 0) {
      setImagePreview(previews[0]);
    }

    if (validImages.length !== files.length) {
      toast.warning("Some files were skipped because they are not images.");
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    handleFileSelection(files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    handleFileSelection(files);
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
    setPreviewImages((prev) => {
      const next = prev.filter((_, imageIndex) => imageIndex !== index);
      setImagePreview(next[0] ?? null);
      return next;
    });
  };

  const startScanning = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Add a photo first.");
      return;
    }

    setIsScanning(true);
    setOcrProgress(0);

    try {
      // Decide whether to use EasyOCR microservice
      let useEasyOcr = false;
      try {
        const health = await fetch("http://localhost:8000/health", { method: "GET" });
        useEasyOcr = health.ok;
      } catch {
        useEasyOcr = false;
      }
      if (preferEasyOcr) {
        if (!useEasyOcr) {
          toast.error("EasyOCR service not reachable. Toggle off or start the service.");
          return;
        }
      }

      const recognizedTexts: string[] = [];
      let successfulCount = 0;

      if (useEasyOcr && preferEasyOcr) {
        for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
          const file = selectedFiles[fileIndex];
          try {
            const form = new FormData();
            form.append("image", file);
            const resp = await fetch("http://localhost:8000/ocr", { method: "POST", body: form });
            if (!resp.ok) throw new Error("Service error");
            const json = await resp.json();
            const text = (json?.text ?? "").trim();
            if (!text || text === "GEEN TEKST GEVONDEN") {
              throw new Error("No usable OCR output");
            }
            recognizedTexts.push(text);
            successfulCount += 1;
          } catch (err) {
            toast.warning(`Failed to scan ${file.name} via EasyOCR. Continuing with the next photo.`);
          }
          const progress = Math.round(((fileIndex + 1) / selectedFiles.length) * 100);
          setOcrProgress(progress);
        }
      } else {
        const { createWorker, PSM } = await import("tesseract.js");
        const { scanModes, workerParams } = getOcrProfile(ocrScanMode, PSM);
        const worker = await createWorker("eng+nld");
        const nativeTextDetector = createNativeTextDetector();

        try {
          await worker.setParameters(workerParams);

          for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
            const file = selectedFiles[fileIndex];

            try {
              const variants = await buildOcrVariants(file);
              const nativeAttempts = nativeTextDetector ? variants.length : 0;
              const attempts = nativeAttempts + variants.length * scanModes.length;
              let attemptIndex = 0;
              const candidates: Array<{ score: number; text: string }> = [];

              if (nativeTextDetector) {
                for (const variant of variants) {
                  const nativeBlocks = await nativeTextDetector.detect(variant.canvas);
                  const nativeText = extractNativeBlockText(nativeBlocks);

                  if (nativeText) {
                    const nativeBoost = ocrScanMode === "screen" ? 20 : 10;
                    candidates.push({
                      score: scoreOcrText(nativeText, 85 + nativeBoost),
                      text: normalizeRecognizedText(nativeText),
                    });
                  }

                  attemptIndex += 1;
                  const progress = ((fileIndex + attemptIndex / attempts) / selectedFiles.length) * 100;
                  setOcrProgress(Math.round(progress));
                }
              }

              for (const variant of variants) {
                for (const mode of scanModes) {
                  await worker.setParameters({ tessedit_pageseg_mode: mode });
                  const result = (await worker.recognize(
                    variant.image,
                    { rotateAuto: true },
                    undefined,
                    `photo-${fileIndex}-${variant.label}-${mode}`,
                  )) as any;

                  const text = normalizeSymbolConfidenceText(result.data?.text ?? "", result.data?.symbols ?? []);
                  const score = scoreOcrText(text, result.data?.confidence ?? 0);
                  candidates.push({ score, text });

                  attemptIndex += 1;
                  const progress = ((fileIndex + attemptIndex / attempts) / selectedFiles.length) * 100;
                  setOcrProgress(Math.round(progress));
                }
              }

              const best = candidates.sort((left, right) => right.score - left.score)[0];
              if (!best || best.text.trim().length < 4 || best.text === "GEEN TEKST GEVONDEN") {
                throw new Error("No usable OCR output");
              }

              recognizedTexts.push(best.text);
              successfulCount += 1;
            } catch {
              toast.warning(`Failed to scan ${file.name}. Continuing with the next photo.`);
            }
          }
        } finally {
          await worker.terminate();
        }
      }

      if (successfulCount === 0) {
        toast.error("OCR failed for all selected photos.");
        return;
      }

      const rawText = recognizedTexts.join("\n");
      const addresses = parseAddressesFromOcrText(rawText);

      if (addresses.length === 0) {
        toast.warning("No addresses detected. You can still add them manually in review.");
      }

      const parsedStops = toStops(addresses);
      const finalStops = optimizeAutomatically
        ? optimizeByNearestNeighbor(parsedStops)
        : parsedStops;

      setRawText(rawText);
      setStops(finalStops);
      setCurrentStopIndex(0);
      toast.success(`Detected ${finalStops.length} stops from ${successfulCount} photo(s).`);
      router.push("/review");
    } catch {
      toast.error("OCR failed. Try a sharper photo or better lighting.");
    } finally {
      setIsScanning(false);
      setOcrProgress(0);
    }
  };

  const selectedCount = selectedFiles.length;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto w-full max-w-md space-y-4 px-4 py-5 pb-[calc(120px+env(safe-area-inset-bottom))] sm:max-w-4xl sm:grid sm:grid-cols-[1fr_340px] sm:gap-5 sm:space-y-0 sm:pb-5">

        {/* Upload card */}
        <div className="space-y-4">
          <Card className="animate-fade-in-up rounded-2xl shadow-sm">
            <CardContent className="space-y-4 p-4">
              <Tabs defaultValue="camera" className="w-full">
                <TabsList className="h-10 w-full rounded-xl">
                  <TabsTrigger value="camera" className="w-1/2 gap-1.5 text-sm">
                    <Camera className="size-4" /> Camera
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="w-1/2 gap-1.5 text-sm">
                    <ImageUp className="size-4" /> Upload
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="camera" className="mt-3">
                  <label
                    onDragEnter={() => setIsDragging(true)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                  >
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                      <Camera className="size-5 text-primary" />
                    </div>
                    <p className="text-sm font-semibold">Take photo(s)</p>
                    <p className="text-xs text-muted-foreground">Use this multiple times if your scanner needs scrolling</p>
                    <input className="sr-only" type="file" accept="image/*" capture="environment" multiple onChange={onFileInput} />
                  </label>
                </TabsContent>

                <TabsContent value="upload" className="mt-3">
                  <label
                    onDragEnter={() => setIsDragging(true)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                  >
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                      <ImageUp className="size-5 text-primary" />
                    </div>
                    <p className="text-sm font-semibold">Upload multiple photos</p>
                    <p className="text-xs text-muted-foreground">Select all pages at once or add in batches</p>
                    <input className="sr-only" type="file" accept="image/*" multiple onChange={onFileInput} />
                  </label>
                </TabsContent>
              </Tabs>

              {selectedCount > 0 ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium">
                  {selectedCount} photo(s) selected
                </div>
              ) : null}

              {previewImages.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {previewImages.map((previewImage, index) => (
                    <div key={`${selectedFiles[index]?.name ?? "image"}-${index}`} className="relative overflow-hidden rounded-xl border bg-muted/10">
                      <img src={previewImage} alt={`Selected delivery list ${index + 1}`} className="h-32 w-full object-cover" />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="absolute top-2 right-2 size-7"
                        onClick={() => removeSelectedFile(index)}
                        disabled={isScanning}
                      >
                        <X className="size-4" />
                      </Button>
                      <div className="px-2 py-1 text-xs text-muted-foreground truncate">
                        {selectedFiles[index]?.name ?? `Photo ${index + 1}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {isScanning ? (
                <div className="space-y-1.5 rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <p className="font-medium">Scanning {selectedCount} photo(s)…</p>
                    <p className="font-mono text-primary">{ocrProgress}%</p>
                  </div>
                  <Progress value={ocrProgress} className="h-2" />
                </div>
              ) : null}

              <Button
                size="lg"
                className="h-13 w-full gap-2 rounded-xl text-base font-semibold"
                onClick={startScanning}
                disabled={isScanning || selectedFiles.length === 0}
              >
                {isScanning ? <Loader2 className="size-5 animate-spin" /> : <ScanSearch className="size-5" />}
                {isScanning ? "Scanning…" : `Scan ${selectedCount > 0 ? selectedCount : ""} photo(s)`}
              </Button>

              <Button
                variant="outline"
                className="h-12 w-full rounded-xl"
                onClick={() => router.push("/review")}
                disabled={isScanning}
              >
                <List className="size-5" /> No OCR? Use voice entry
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar — hidden on mobile (settings live in the dock sheet) */}
        <div className="space-y-4 hidden sm:block">
        </div>
      </main>

      {/* Apple glass dock */}
      <div className="fixed right-0 bottom-0 left-0 z-50 sm:hidden">
        <div className="mx-auto max-w-md px-4 pb-[calc(10px+env(safe-area-inset-bottom))]">
          <div className="rounded-[2rem] border border-white/40 bg-white/55 p-2 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-black/35">
            <div className="relative flex items-stretch">
              {/* Sliding pill — resting on Home */}
              <div
                className="pointer-events-none absolute inset-y-0 w-1/4 rounded-[1.2rem] bg-white/80 shadow-sm dark:bg-white/20"
                style={{ transform: "translateX(0%)", opacity: 1 }}
              />
              <Button
                variant="ghost"
                className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80"
                onClick={() => router.push("/")}
              >
                <Home className="size-5" />
                Home
              </Button>
              <Button
                variant="ghost"
                className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80"
                onClick={() => router.push("/review")}
              >
                <List className="size-5" />
                Stops
              </Button>
              <Button
                variant="ghost"
                className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80"
                onClick={() => router.push("/navigation")}
              >
                <MapPinned className="size-5" />
                Map
              </Button>
              <Button
                variant="ghost"
                className="relative z-10 h-16 w-1/4 flex-col gap-1 rounded-[1.5rem] px-0 text-[11px] font-semibold text-foreground/80"
                onClick={() => setSettingsOpen(true)}
              >
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
                  <Switch
                    checked={optimizeAutomatically}
                    onCheckedChange={(next) => setOptimizeAutomatically(Boolean(next))}
                  />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">OCR profile</p>
                <Tabs value={ocrScanMode} onValueChange={(next) => setOcrScanMode(next as OcrScanMode)}>
                  <TabsList className="h-10 w-full rounded-xl">
                    <TabsTrigger value="mixed" className="w-1/3 text-xs">Mixed</TabsTrigger>
                    <TabsTrigger value="screen" className="w-1/3 text-xs">Screen</TabsTrigger>
                    <TabsTrigger value="handwriting" className="w-1/3 text-xs">Handwriting</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {ocrScanMode === "screen"
                    ? "Best for photos of displays, labels, and printed lists."
                    : ocrScanMode === "handwriting"
                      ? "Best effort for handwritten notes with uneven spacing."
                      : "Balanced mode that tries multiple OCR strategies."}
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">OCR Engine</p>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Prefer EasyOCR service</p>
                    <p className="text-xs text-muted-foreground">If enabled the app will require the local EasyOCR service.</p>
                  </div>
                  <Switch checked={preferEasyOcr} onCheckedChange={(next) => setPreferEasyOcr(Boolean(next))} />
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setSettingsOpen(false); router.push("/review"); }}>
                <List className="size-4" /> Review stops
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => window.open(`https://maps.google.com`, "_blank")}>
                <Route className="size-4" /> Open Maps
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
