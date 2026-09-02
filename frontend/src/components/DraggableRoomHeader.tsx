import { useState } from 'react';
import { Link, Check } from 'lucide-react';
import { ShroomLogo } from './ShroomLogo';

interface Props {
  roomId: string;
}

export function DraggableRoomHeader({ roomId }: Props) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      const inviteLink = `${window.location.origin}/${roomId}${window.location.hash}`;
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="shroom-room-header">
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="shroom-mark flex-shrink-0">
          <ShroomLogo className="w-4 h-4" />
        </div>

        <div className="flex flex-col items-start leading-none ml-1 min-w-0">
          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-shroom-primary mb-0.5 whitespace-nowrap">
            Room code
          </span>
          <span className="font-mono text-xs sm:text-sm font-bold text-white truncate w-full max-w-[120px] sm:max-w-[200px]">
            {roomId}
          </span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center">
        <button
          type="button"
          onClick={copyCode}
          className="shroom-header-button shroom-copy-button"
          aria-label={copied ? 'Invite link copied' : 'Copy invite link'}
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Link size={14} />}
          <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          <span className="sm:hidden">{copied ? 'Done' : 'Copy'}</span>
        </button>

      </div>
    </div>
  );
}
