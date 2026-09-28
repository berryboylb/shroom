interface Props {
  className?: string;
}

export function ShroomLogo({ className = "w-10 h-10" }: Props) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="translate(10 10) scale(.8)">
        <path d="M13 55C13 31.8 29.6 16 50 16s37 15.8 37 39c0 3.9-3.1 7-7 7H20c-3.9 0-7-3.1-7-7Z" fill="currentColor" />
        <path d="M37 58h26v20.5C63 85.4 57.2 90 50 90s-13-4.6-13-11.5V58Z" fill="currentColor" />
        <circle cx="33" cy="40" r="4" fill="var(--shroom-primary, #2563eb)" />
        <circle cx="51" cy="29" r="3.5" fill="var(--shroom-primary, #2563eb)" />
        <circle cx="69" cy="41" r="4.5" fill="var(--shroom-primary, #2563eb)" />
      </g>
    </svg>
  );
}
