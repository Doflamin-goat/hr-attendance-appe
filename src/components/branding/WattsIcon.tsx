type Props = { className?: string };

export function WattsIcon({ className = "h-9 w-9" }: Props) {
  return <img src="/watts-icon.svg" alt="" aria-hidden="true" className={className} />;
}
