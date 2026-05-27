"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AddressStop, EditableAddress } from "@/types/route";
import { normalizeStop } from "@/lib/address";

type RouteState = {
  imagePreview: string | null;
  rawText: string;
  stops: AddressStop[];
  optimizeAutomatically: boolean;
  currentStopIndex: number;
  pageSize: number;
  setImagePreview: (value: string | null) => void;
  setRawText: (value: string) => void;
  setOptimizeAutomatically: (value: boolean) => void;
  setStops: (stops: AddressStop[]) => void;
  addStop: (stop: EditableAddress) => void;
  updateStop: (id: string, next: Partial<EditableAddress>) => void;
  deleteStop: (id: string) => void;
  reorderStops: (fromIndex: number, toIndex: number) => void;
  markDelivered: (id: string, delivered: boolean) => void;
  setCurrentStopIndex: (index: number) => void;
  reset: () => void;
};

const initialState = {
  imagePreview: null,
  rawText: "",
  stops: [] as AddressStop[],
  optimizeAutomatically: true,
  currentStopIndex: 0,
  pageSize: 20,
};

export const useRouteStore = create<RouteState>()(
  persist(
    (set) => ({
      ...initialState,
      setImagePreview: (value) => set({ imagePreview: value }),
      setRawText: (value) => set({ rawText: value }),
      setOptimizeAutomatically: (value) => set({ optimizeAutomatically: value }),
      setStops: (stops) => set({ stops, currentStopIndex: 0 }),
      addStop: (stop) =>
        set((state) => {
          const id = `stop-${Date.now()}`;
          return {
            stops: [
              ...state.stops,
              normalizeStop({
                ...stop,
                id,
                delivered: false,
              }),
            ],
          };
        }),
      updateStop: (id, next) =>
        set((state) => ({
          stops: state.stops.map((stop) =>
            stop.id === id
              ? normalizeStop({
                  ...stop,
                  ...next,
                })
              : stop,
          ),
        })),
      deleteStop: (id) =>
        set((state) => ({
          stops: state.stops.filter((stop) => stop.id !== id),
          currentStopIndex: Math.max(0, Math.min(state.currentStopIndex, state.stops.length - 2)),
        })),
      reorderStops: (fromIndex, toIndex) =>
        set((state) => {
          const next = [...state.stops];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return { stops: state.stops };
          next.splice(toIndex, 0, moved);
          return { stops: next };
        }),
      markDelivered: (id, delivered) =>
        set((state) => ({
          stops: state.stops.map((stop) =>
            stop.id === id ? { ...stop, delivered } : stop,
          ),
        })),
      setCurrentStopIndex: (index) => set({ currentStopIndex: index }),
      reset: () => set(initialState),
    }),
    {
      name: "delivery-route-scanner-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        imagePreview: state.imagePreview,
        rawText: state.rawText,
        stops: state.stops,
        optimizeAutomatically: state.optimizeAutomatically,
        currentStopIndex: state.currentStopIndex,
        pageSize: state.pageSize,
      }),
    },
  ),
);