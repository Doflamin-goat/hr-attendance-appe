import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, X } from "lucide-react";
import type { ExemptionPicture } from "../../context/AttendanceContext";
import { Button } from "../ui";

function PictureViewer({
  pictures,
  employeeName,
  index,
  onClose,
  onNavigate,
}: {
  pictures: ExemptionPicture[];
  employeeName: string;
  index: number;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef({ onClose, onNavigate });
  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const picture = pictures[index];
  actionRef.current = { onClose, onNavigate };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") actionRef.current.onClose();
      if (event.key === "ArrowLeft") { event.preventDefault(); actionRef.current.onNavigate(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); actionRef.current.onNavigate(1); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);
  useEffect(() => { setImageLoading(true); setImageFailed(false); }, [picture?.url]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="exemption-evidence-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="exemption-evidence-title" className="text-base font-semibold text-slate-900">Employee evidence</h2>
            <p className="truncate text-sm text-slate-500">{employeeName}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close picture viewer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><X className="h-5 w-5" /></button>
        </header>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-950 px-2 py-3 sm:px-12 sm:py-5">
          {picture && !imageFailed && <img src={picture.url} alt={`Evidence picture ${index + 1} for ${employeeName}`} onLoad={() => setImageLoading(false)} onError={() => { setImageLoading(false); setImageFailed(true); }} className={`max-h-[calc(92vh-170px)] max-w-full object-contain transition-opacity ${imageLoading ? "opacity-0" : "opacity-100"}`} />}
          {imageLoading && !imageFailed && <div className="absolute flex items-center gap-2 text-sm text-white/80" role="status"><LoaderCircle className="h-5 w-5 animate-spin" />Loading picture…</div>}
          {imageFailed && <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-white/80" role="status"><ImagePlus className="h-8 w-8" /><span>This picture could not be loaded.</span></div>}
          {pictures.length > 1 && <>
            <button type="button" onClick={() => onNavigate(-1)} disabled={index === 0} aria-label="Previous picture" className="absolute left-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:left-4 sm:h-12 sm:w-12"><ChevronLeft className="h-6 w-6" /></button>
            <button type="button" onClick={() => onNavigate(1)} disabled={index === pictures.length - 1} aria-label="Next picture" className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:right-4 sm:h-12 sm:w-12"><ChevronRight className="h-6 w-6" /></button>
          </>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-6">
          <p className="text-sm font-medium text-slate-600">Picture {index + 1} of {pictures.length}</p>
          {pictures.length > 1 && <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" leftIcon={<ChevronLeft className="h-4 w-4" />} disabled={index === 0} onClick={() => onNavigate(-1)}>Previous</Button>
            <Button size="sm" variant="secondary" rightIcon={<ChevronRight className="h-4 w-4" />} disabled={index === pictures.length - 1} onClick={() => onNavigate(1)}>Next</Button>
          </div>}
        </footer>
      </section>
    </div>
  );
}

function PictureThumbnail({ picture, index, total, onClick }: { picture: ExemptionPicture; index: number; total: number; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onClick} aria-label={`Open picture ${index + 1} of ${total}`} className="group relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      {!failed ? <img src={picture.url} alt={`Exemption evidence ${index + 1}`} onError={() => setFailed(true)} className="h-full w-full object-cover transition group-hover:scale-105" /> : <span className="flex h-full w-full items-center justify-center text-slate-400"><ImagePlus className="h-6 w-6" /></span>}
      <span className="sr-only">{picture.fileName}</span>
    </button>
  );
}

export function ExemptionPictureGallery({
  pictures,
  employeeName,
  onRemove,
  title = "Pictures",
}: {
  pictures: ExemptionPicture[];
  employeeName: string;
  onRemove?: (picture: ExemptionPicture) => void;
  title?: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  if (pictures.length === 0) return null;

  return (
    <>
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="flex flex-wrap gap-2">
          {pictures.map((picture, index) => <div key={picture.id} className="w-[88px]">
            <PictureThumbnail picture={picture} index={index} total={pictures.length} onClick={() => setViewerIndex(index)} />
            {onRemove && <Button size="sm" variant="danger" className="mt-1 w-full px-2" aria-label={`Remove ${picture.fileName}`} onClick={() => onRemove(picture)}>Remove</Button>}
          </div>)}
        </div>
      </div>
      {viewerIndex !== null && <PictureViewer pictures={pictures} employeeName={employeeName} index={viewerIndex} onClose={() => setViewerIndex(null)} onNavigate={(direction) => setViewerIndex((current) => current === null ? null : Math.max(0, Math.min(pictures.length - 1, current + direction)))} />}
    </>
  );
}
