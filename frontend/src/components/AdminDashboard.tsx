import { useState, useEffect } from 'react';
import { Activity, Users, Server, AlertTriangle, ArrowLeft } from 'lucide-react';
import { ShroomLogo } from './ShroomLogo';

interface Metrics {
  memory_alloc_mb: number;
  goroutines: number;
  active_rooms: number;
  total_http_reqs: number;
  total_http_errs: number;
  active_ws_clients: number;
  uptime_seconds: number;
}

export function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/admin/metrics');
        if (!res.ok) throw new Error('Failed to fetch metrics');
        const data = await res.json();
        setMetrics(data);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.location.hash = ''}
              className="p-3 bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
              <ShroomLogo className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">System Metrics</h1>
              <p className="text-slate-400 font-medium text-sm mt-1">Live telemetry • Ultra-low footprint</p>
            </div>
          </div>
          
          {metrics && (
            <div className="text-right">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-full font-bold text-sm border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Uptime: {formatUptime(metrics.uptime_seconds)}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center gap-3 mb-8">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Connection to telemetry lost. Retrying...</span>
          </div>
        )}

        {metrics ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <MetricCard 
              icon={<Server className="w-6 h-6 text-blue-400" />}
              title="Memory Usage (Go)"
              value={`${metrics.memory_alloc_mb} MB`}
              trend="Allocated"
            />
            <MetricCard 
              icon={<Users className="w-6 h-6 text-indigo-400" />}
              title="Active Rooms"
              value={metrics.active_rooms.toString()}
              trend="Postgres"
            />
            <MetricCard 
              icon={<Activity className="w-6 h-6 text-emerald-400" />}
              title="Total HTTP Requests"
              value={metrics.total_http_reqs.toLocaleString()}
              trend={`${metrics.total_http_errs} errors`}
            />
            <MetricCard 
              icon={<Activity className="w-6 h-6 text-purple-400" />}
              title="Active Goroutines"
              value={metrics.goroutines.toLocaleString()}
              trend="Threads"
            />
            <MetricCard 
              icon={<Users className="w-6 h-6 text-amber-400" />}
              title="Active WebSockets"
              value={metrics.active_ws_clients.toString()}
              trend="Connections"
            />
          </div>
        ) : (
          !error && (
            <div className="flex justify-center items-center h-64">
              <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, title, value, trend }: any) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] shadow-xl relative overflow-hidden group">
      <div className="absolute -right-4 -top-4 bg-slate-800/30 w-24 h-24 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors"></div>
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-slate-950 rounded-2xl shadow-inner border border-slate-800">
          {icon}
        </div>
      </div>
      <p className="text-slate-400 font-medium text-sm mb-1">{title}</p>
      <div className="flex items-end justify-between">
        <h3 className="text-4xl font-bold text-white tracking-tight">{value}</h3>
        <span className="text-sm font-bold text-slate-500 bg-slate-950 px-3 py-1 rounded-full border border-slate-800">{trend}</span>
      </div>
    </div>
  );
}
