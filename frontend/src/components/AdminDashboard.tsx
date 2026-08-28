import { useState } from 'react';
import { Activity, Users, Server, AlertTriangle, ArrowLeft, Loader2, ArrowRight } from 'lucide-react';
import useSWR from 'swr';
import { ShroomLogo } from './ShroomLogo';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';

interface Metrics {
  memory_alloc_mb: number;
  goroutines: number;
  active_rooms: number;
  total_http_reqs: number;
  total_http_errs: number;
  active_ws_clients: number;
  uptime_seconds: number;
}

// Authenticated fetcher that sends the JWT token
const createFetcher = (token: string) => (url: string) =>
  fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(res => {
    if (!res.ok) throw new Error('Network response was not ok');
    return res.json();
  });

function AdminLoginGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setDisplayName = useAuthStore(state => state.setDisplayName);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await authApi.loginGuest(name.trim());
      setAccessToken(res.access_token);
      setDisplayName(name.trim());
      onAuthenticated();
    } catch {
      setError('Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8 font-sans">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShroomLogo className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Admin Access</h1>
          <p className="text-slate-400 text-sm mt-2">Authenticate to view system metrics</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder:text-slate-500"
            placeholder="Enter your name"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={isLoading || !name.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-all flex justify-center items-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const token = useAuthStore(state => state.accessToken);
  const [authed, setAuthed] = useState(!!token);

  if (!authed || !token) {
    return <AdminLoginGate onAuthenticated={() => setAuthed(true)} />;
  }

  const fetcher = createFetcher(token);

  return <AdminDashboardContent fetcher={fetcher} />;
}

function AdminDashboardContent({ fetcher }: { fetcher: (url: string) => Promise<Metrics> }) {
  const { data: metrics, error } = useSWR<Metrics>('/api/admin/metrics', fetcher, {
    refreshInterval: 3000,
    revalidateOnFocus: true,
  });

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
              onClick={() => window.location.href = '/'}
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
