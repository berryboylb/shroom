import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Check, GripHorizontal } from 'lucide-react';
import { DeviceSettings } from './DeviceSettings';

interface Props {
  roomId: string;
}

export function DraggableRoomHeader({ roomId }: Props) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      const inviteLink = `${window.location.origin}/?room=${roomId}`;
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <motion.div 
      drag 
      dragMomentum={false}
      className="absolute top-6 left-6 z-50 flex items-center gap-3 bg-white/70 dark:bg-slate-800/80 backdrop-blur-2xl border border-white/30 dark:border-slate-600/50 shadow-2xl p-2 pr-4 rounded-3xl cursor-grab active:cursor-grabbing"
    >
      <div className="pl-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 transition-colors">
        <GripHorizontal size={20} />
      </div>
      
      <div className="flex flex-col items-start leading-none ml-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-1">
          Meeting Link
        </span>
        <span className="font-mono text-sm font-bold text-slate-900 dark:text-white select-all">
          {roomId}
        </span>
      </div>

      <button
        onClick={copyCode}
        className="ml-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 font-semibold text-xs"
        title="Copy Invite Link"
      >
        {copied ? <Check size={16} className="text-emerald-500" /> : <Link size={16} />}
        {copied ? 'Copied URL!' : 'Copy Link'}
      </button>

      <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 mx-1"></div>

      <DeviceSettings />
      
      <button 
        onClick={() => document.documentElement.classList.toggle('dark')}
        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all hover:scale-105 active:scale-95"
        aria-label="Toggle Dark Mode"
      >
        🌓
      </button>
    </motion.div>
  );
}
