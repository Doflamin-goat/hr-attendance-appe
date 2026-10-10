import { X } from "lucide-react";

type InformedPersonChipsProps = {
  people: string[];
  onRemove: (person: string) => void;
};

/** Names remain plain text; the icon button is a separate removable action. */
export function InformedPersonChips({ people, onRemove }: InformedPersonChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((person) => (
        <span key={person} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-medium text-brand-700">
          <span>{person}</span>
          <button
            type="button"
            aria-label={`Remove ${person}`}
            onClick={() => onRemove(person)}
            className="inline-flex size-5 items-center justify-center rounded-full hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X aria-hidden="true" size={13} strokeWidth={2.5} />
          </button>
        </span>
      ))}
    </div>
  );
}
