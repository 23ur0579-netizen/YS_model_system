import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, RotateCcw, Wand2, Check, Loader2 } from "lucide-react";

// Viewport (crop window) size in on-screen CSS pixels, and the output
// image size (square) saved to the server.
const VIEWPORT = 280;
const OUTPUT_SIZE = 400;
const MAX_ZOOM = 3;

/**
 * A small, dependency-free crop tool: drag to reposition, use the slider
 * (or the "Suggested crop" button) to reset to a sensible centered
 * framing, then Save renders the cropped region to a canvas and hands
 * back a JPEG data: URL. No image-cropping library is installed in this
 * project, so this works entirely off the Canvas API + pointer events.
 */
export function ImageCropper({
  imageSrc,
  onCancel,
  onSave,
  title = "Crop your photo",
}: {
  imageSrc: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void | Promise<void>;
  title?: string;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Crop window center + zoom, all in *natural image pixel* coordinates.
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [zoom, setZoom] = useState(1); // 1 = most zoomed out (crop window = the shorter image side)
  const [suggested, setSuggested] = useState(true);
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  function suggestedCrop(w: number, h: number) {
    // A slightly tighter, face-friendly default rather than a plain dead-
    // center square: most portrait photos have the subject's face above
    // the vertical midpoint, so this nudges the window up a bit and zooms
    // in slightly — a better starting point than the raw center crop the
    // app used to save automatically with no way to adjust it.
    return { cx: w / 2, cy: h * 0.45, zoom: 1.2 };
  }

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    setNatural({ w, h });
    const s = suggestedCrop(w, h);
    const side = Math.min(w, h) / s.zoom;
    setCx(clamp(s.cx, side, w)); setCy(clamp(s.cy, side, h)); setZoom(s.zoom);
  }

  function cropSide() {
    if (!natural) return 1;
    return Math.min(natural.w, natural.h) / zoom;
  }

  function clamp(value: number, side: number, max: number) {
    const half = side / 2;
    if (max <= side) return max / 2;
    return Math.min(Math.max(value, half), max - half);
  }

  function applySuggested() {
    if (!natural) return;
    const s = suggestedCrop(natural.w, natural.h);
    const side = Math.min(natural.w, natural.h) / s.zoom;
    setCx(clamp(s.cx, side, natural.w)); setCy(clamp(s.cy, side, natural.h)); setZoom(s.zoom);
    setSuggested(true);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, cx, cy };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !natural) return;
    const side = cropSide();
    const displayScale = VIEWPORT / side; // screen px per natural px
    const dxScreen = e.clientX - dragRef.current.x;
    const dyScreen = e.clientY - dragRef.current.y;
    // Dragging the photo right should reveal what was to its left —
    // i.e. move the crop window left, hence the minus sign.
    const newCx = clamp(dragRef.current.cx - dxScreen / displayScale, side, natural.w);
    const newCy = clamp(dragRef.current.cy - dyScreen / displayScale, side, natural.h);
    setCx(newCx); setCy(newCy);
    setSuggested(false);
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(z: number) {
    if (!natural) return;
    setZoom(z);
    const side = Math.min(natural.w, natural.h) / z;
    setCx((v) => clamp(v, side, natural.w));
    setCy((v) => clamp(v, side, natural.h));
    setSuggested(false);
  }

  async function save() {
    if (!natural || !imgRef.current) return;
    setSaving(true);
    try {
      const side = cropSide();
      const sx = cx - side / 2;
      const sy = cy - side / 2;
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(imgRef.current, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      await onSave(dataUrl);
    } finally {
      setSaving(false);
    }
  }

  // Position/size of the <img> so that the natural point (cx, cy) sits
  // at the center of the fixed VIEWPORT×VIEWPORT crop window.
  const side = cropSide();
  const displayScale = natural ? VIEWPORT / side : 1;
  const imgStyle: React.CSSProperties = natural
    ? {
        position: "absolute",
        width: natural.w * displayScale,
        height: natural.h * displayScale,
        left: VIEWPORT / 2 - cx * displayScale,
        top: VIEWPORT / 2 - cy * displayScale,
        maxWidth: "none",
        userSelect: "none",
        touchAction: "none",
      }
    : { display: "none" };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-slate-900">{title}</span>
          <button onClick={onCancel} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="relative mx-auto rounded-full overflow-hidden bg-slate-100 border border-slate-200 cursor-move touch-none"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img ref={imgRef} src={imageSrc} onLoad={onImgLoad} style={imgStyle} draggable={false} />
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))}
            className="w-full accent-emerald-600"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={applySuggested}
            disabled={suggested}
            className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
            title="Reset to a centered, evenly-zoomed suggested crop"
          >
            <Wand2 className="h-3.5 w-3.5" /> Suggested crop
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(1)}
            className="h-9 w-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
            title="Reset zoom"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Drag the photo to reposition it, and use the slider to zoom. "Suggested crop" centers the photo
          for you — a good starting point for most portrait photos.
        </p>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button onClick={onCancel} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !natural}
            className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving…" : "Save photo"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
