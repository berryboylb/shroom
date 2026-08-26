import { TrackToggle, DisconnectButton } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function DeviceSettings() {
  return (
    <div className="flex items-center gap-3 bg-white/10 dark:bg-slate-900/50 backdrop-blur-md p-3 rounded-2xl border border-white/20 dark:border-slate-700/50 shadow-xl">
      <TrackToggle 
        source={Track.Source.Camera} 
        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl transition-colors font-medium shadow-sm data-[state=off]:bg-red-500 data-[state=off]:hover:bg-red-600"
      />
      <TrackToggle 
        source={Track.Source.Microphone} 
        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl transition-colors font-medium shadow-sm data-[state=off]:bg-red-500 data-[state=off]:hover:bg-red-600"
      />
      <div className="w-px h-8 bg-white/20 mx-1"></div>
      <DisconnectButton 
        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl shadow-sm transition-colors"
      >
        Leave Room
      </DisconnectButton>
    </div>
  );
}
