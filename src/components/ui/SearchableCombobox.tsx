import { useMemo, useState } from "react";

type ComboboxOption = { id: string; label: string };

type Props = {
  label: string;
  placeholder?: string;
  options: ComboboxOption[];
  value?: string;
  required?: boolean;
  onSelect: (option: ComboboxOption) => void;
  onClear?: () => void;
  onCreateCustom?: (label: string) => void;
};

export function SearchableCombobox({ label, placeholder = "Search", options, value = "", required, onSelect, onClear, onCreateCustom }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query]);
  const select = (option: ComboboxOption) => { setQuery(option.label); setOpen(false); onSelect(option); };
  const customLabel = query.trim();

  return <div className="relative w-full">
    <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
    <input value={open ? query : value} required={required} placeholder={placeholder} autoComplete="off" onFocus={() => { setQuery(value); setOpen(true); }} onBlur={() => setOpen(false)} onChange={(event) => { setQuery(event.target.value); setOpen(true); onClear?.(); }} onKeyDown={(event) => { if (event.key === "Enter" && onCreateCustom && customLabel && matches.length === 0) { event.preventDefault(); onCreateCustom(customLabel); setQuery(""); setOpen(false); } }} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
    {open ? <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">{matches.map((option) => <button key={option.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)} className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">{option.label}</button>)}{onCreateCustom && customLabel && !options.some((option) => option.label.toLocaleLowerCase() === customLabel.toLocaleLowerCase()) ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onCreateCustom(customLabel); setQuery(""); setOpen(false); }} className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50">Add “{customLabel}”</button> : null}{matches.length === 0 && !onCreateCustom ? <p className="px-3 py-2 text-sm text-slate-500">No matches found.</p> : null}</div> : null}
  </div>;
}
