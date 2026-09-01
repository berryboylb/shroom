import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Check, GripHorizontal, Moon, Sun } from 'lucide-react';
import { ShroomLogo } from './ShroomLogo';

interface Props {
  roomId: string;
}

export function DraggableRoomHeader({ roomId }: Props) {
  const [copied, setCopied] = useState(false);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));

  const copyCode = async () => {
    try {
      const inviteLink = `${window.location.origin}/?room=${roomId}${window.location.hash}`;
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark');
    setIsDark(!isDark);
  };

  return (
    <motion.div 
      drag 
      dragMomentum={false}
      className="absolute top-[env(safe-area-inset-top,1.5rem)] left-2 right-2 sm:left-6 sm:right-auto z-50 flex items-center justify-between sm:justify-start gap-2 bg-white/80 dark:bg-slate-800/90 backdrop-blur-2xl border border-white/40 dark:border-slate-600/50 shadow-2xl p-2 sm:p-2 sm:pr-4 rounded-3xl cursor-grab active:cursor-grabbing max-w-[calc(100vw-16px)] sm:max-w-max"
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="pl-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 transition-colors flex-shrink-0">
          <GripHorizontal size={20} />
        </div>
        
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md flex-shrink-0">
          <ShroomLogo className="w-4 h-4" />
        </div>

        <div className="flex flex-col items-start leading-none ml-1 min-w-0">
          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-0.5 whitespace-nowrap">
            Meeting Link
          </span>
          <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate w-full max-w-[120px] sm:max-w-[200px]">
            {roomId}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto">
        <button
          onClick={copyCode}
          className="px-2.5 py-2 sm:px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 font-semibold text-xs"
          title="Copy Invite Link"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Link size={14} />}
          <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          <span className="sm:hidden">{copied ? 'Done' : 'Copy'}</span>
        </button>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block"></div>
        
        <button 
          onClick={toggleDarkMode}
          className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all hover:scale-105 active:scale-95 flex-shrink-0"
          aria-label="Toggle Dark Mode"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </motion.div>
  );
}
