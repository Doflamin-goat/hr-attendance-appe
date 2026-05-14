import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { UploadCloud, FileSpreadsheet } from "lucide-react";

export type DragDropUploadHandle = {
  open: () => void;
};

type DragDropUploadProps = {
  onFileSelect: (file: File) => void;
  onInvalidFile?: (message: string) => void;
  density?: "comfortable" | "compact";
};

export const DragDropUpload = forwardRef<DragDropUploadHandle, DragDropUploadProps>(
  function DragDropUpload(
    { onFileSelect, onInvalidFile, density = "comfortable" },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    useImperativeHandle(ref, () => ({
      open: () => inputRef.current?.click(),
    }));

    function handleFile(file: File) {
      const isExcel =
        file.name.toLowerCase().endsWith(".xlsx") ||
        file.name.toLowerCase().endsWith(".xls");

      if (!isExcel) {
        const message = "Please upload an Excel file (.xlsx or .xls).";
        if (onInvalidFile) {
          onInvalidFile(message);
        } else {
          console.warn(message);
        }
        return;
      }

      onFileSelect(file);
    }

    const isCompact = density === "compact";

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
          isCompact ? "px-4 py-5" : "px-6 py-8"
        } ${
          isDragging
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/40"
        }`}
      >
        <div
          className={`flex items-center justify-center rounded-full bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100 ${
            isCompact ? "h-10 w-10" : "h-12 w-12"
          }`}
        >
          <UploadCloud className={isCompact ? "h-5 w-5" : "h-6 w-6"} />
        </div>

        <p
          className={`mt-3 font-semibold text-slate-900 ${
            isCompact ? "text-sm" : "text-[15px]"
          }`}
        >
          Drag &amp; drop attendance file
        </p>

        <p className="mt-0.5 text-xs text-slate-500">
          or click to browse
        </p>

        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
          <FileSpreadsheet className="h-3 w-3 text-slate-400" />
          Supported: .xlsx, .xls
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }
);

export default DragDropUpload;
