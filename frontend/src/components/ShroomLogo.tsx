interface Props {
  className?: string;
}

export function ShroomLogo({ className = "w-10 h-10" }: Props) {
  return (
    <svg 
      viewBox="0 0 100 100" 
      fill="none" 
      className={className} 
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15 60 C 15 20, 85 20, 85 60 Z" fill="currentColor" />
      <path d="M38 60 L 38 80 C 38 88, 62 88, 62 80 L 62 60 Z" fill="currentColor" />
    </svg>
  );
}
