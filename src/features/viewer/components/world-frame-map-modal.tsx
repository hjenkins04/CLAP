import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Check, X, SkipForward } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useWorldFrameStore, type GeoPoint } from '../plugins/world-frame';

interface WorldFrameMapModalProps {
  engine: unknown;
}

export function WorldFrameMapModal(_props: WorldFrameMapModalProps) {
  const phase = useWorldFrameStore((s) => s.phase);
  const setGeoPoint1 = useWorldFrameStore((s) => s.setGeoPoint1);
  const setGeoPoint2 = useWorldFrameStore((s) => s.setGeoPoint2);
  const setPhase = useWorldFrameStore((s) => s.setPhase);
  const resetWorldFrame = useWorldFrameStore((s) => s.resetWorldFrame);
  const exitMode = useViewerModeStore((s) => s.exitMode);

  const isOpen = phase === 'map-pick-first' || phase === 'map-pick-second';

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Pending point awaiting confirmation
  const [pendingPoint, setPendingPoint] = useState<GeoPoint | null>(null);
  const [pendingPopupPos, setPendingPopupPos] = useState<{ x: number; y: number } | null>(null);

  // Track click for double-click detection (MapLibre eats dblclick for zoom)
  const lastClickRef = useRef<{ time: number; lng: number; lat: number } | null>(null);

  const handleCancel = useCallback(() => {
    resetWorldFrame();
    exitMode();
  }, [resetWorldFrame, exitMode]);

  const handleConfirmPoint = useCallback(() => {
    if (!pendingPoint) return;

    if (phase === 'map-pick-first') {
      setGeoPoint1(pendingPoint);

      // Add marker to map
      if (mapRef.current) {
        const marker = new maplibregl.Marker({ color: '#22c55e' })
          .setLngLat([pendingPoint.lng, pendingPoint.lat])
          .addTo(mapRef.current);
        markersRef.current.push(marker);
      }

      setPhase('map-pick-second');
    } else if (phase === 'map-pick-second') {
      setGeoPoint2(pendingPoint);

      // Add marker
      if (mapRef.current) {
        const marker = new maplibregl.Marker({ color: '#3b82f6' })
          .setLngLat([pendingPoint.lng, pendingPoint.lat])
          .addTo(mapRef.current);
        markersRef.current.push(marker);
      }

      setPhase('pc-pick-first');
    }

    setPendingPoint(null);
    setPendingPopupPos(null);
  }, [pendingPoint, phase, setGeoPoint1, setGeoPoint2, setPhase]);

  const handleSkipSecond = useCallback(() => {
    setGeoPoint2(null);
    setPhase('pc-pick-first');
  }, [setGeoPoint2, setPhase]);

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'esri-imagery': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'esri-imagery' }],
      },
      // If a world frame (e.g. from crs.json auto-detection) is already confirmed,
      // center the map on the known reference location and zoom in close.
      center: ((): [number, number] => {
        const existing = useWorldFrameStore.getState().transform;
        return existing?.refGeo
          ? [existing.refGeo.lng, existing.refGeo.lat]
          : [-79.68, 47.5];
      })(),
      zoom: useWorldFrameStore.getState().transform?.refGeo ? 15 : 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [isOpen]);

  // Handle double-click to place point
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isOpen) return;

    // Disable MapLibre's default double-click zoom so we can use it for selection
    map.doubleClickZoom.disable();

    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      const lngLat = e.lngLat;
      setPendingPoint({ lng: lngLat.lng, lat: lngLat.lat });
      const point = map.project(lngLat);
      setPendingPopupPos({ x: point.x, y: point.y });
    };

    map.on('dblclick', onDblClick);
    return () => {
      map.off('dblclick', onDblClick);
    };
  }, [isOpen]);

  // Keyboard: Escape to cancel, Enter to confirm pending
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingPoint) {
          setPendingPoint(null);
          setPendingPopupPos(null);
        } else {
          handleCancel();
        }
      } else if (e.key === 'Enter' && pendingPoint) {
        handleConfirmPoint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pendingPoint, handleCancel, handleConfirmPoint]);

  if (!isOpen) return null;

  const isPickingSecond = phase === 'map-pick-second';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">
            {isPickingSecond ? 'Select Second Anchor Point' : 'Select First Anchor Point'}
          </h2>
          <span className="text-xs text-gray-400">
            Double-click to place a point
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isPickingSecond && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-gray-600 text-xs text-gray-300 hover:bg-gray-800"
              onClick={handleSkipSecond}
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip (single point)
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            onClick={handleCancel}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      </div>

      {/* Map container */}
      <div className="relative flex-1">
        <div ref={mapContainerRef} className="h-full w-full" />

        {/* Confirmation popup near the point */}
        {pendingPoint && pendingPopupPos && (
          <div
            className="absolute z-10"
            style={{ left: pendingPopupPos.x + 12, top: pendingPopupPos.y - 20 }}
          >
            <div className="flex items-center gap-1 rounded-lg border border-gray-600 bg-gray-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
              <span className="mr-1 text-xs text-gray-300">
                {pendingPoint.lat.toFixed(6)}, {pendingPoint.lng.toFixed(6)}
              </span>
              <Button
                variant="default"
                size="sm"
                className="h-5 gap-0.5 px-1.5 text-xs"
                onClick={handleConfirmPoint}
              >
                <Check className="h-3 w-3" />
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs text-gray-400"
                onClick={() => {
                  setPendingPoint(null);
                  setPendingPopupPos(null);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
