import { useState } from 'react';
import { Activity, Users, Server, AlertTriangle, ArrowLeft, Loader2, ArrowRight } from 'lucide-react';
import useSWR from 'swr';
import { ShroomLogo } from './ShroomLogo';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';

interface Metrics {
  memory_alloc_mb: number;
  memory_sys_mb: number;
  memory_budget_mb: number;
  goroutines: number;
  active_rooms: number;
  total_http_reqs: number;
  total_http_errs: number;
  active_ws_clients: number;
  uptime_seconds: number;
}

interface TelemetryReport {
  roomId: string;
  participantName: string;
  quality: string;
  receivedAt: string;
  metrics: { rttMs: number; packetLossPercent: number; candidateType: string; codec: string };
}

interface TelemetryResponse { reports: TelemetryReport[]; capacity: number }

// Authenticated fetcher that sends the JWT token
const createFetcher = (token: string) => (url: string): Promise<any> =>
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
    <div className="shroom-admin flex min-h-[100dvh] items-center justify-center p-5 text-white font-sans sm:p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="shroom-mark mx-auto mb-4">
            <ShroomLogo className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin access</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Authenticate to view system metrics.</p>
        </div>
        <form onSubmit={handleLogin} className="shroom-admin-card space-y-4">
          <label htmlFor="admin-name" className="shroom-eyebrow">Display name</label>
          <input
            id="admin-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="shroom-input w-full"
            placeholder="Your display name"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={isLoading || !name.trim()}
            className="shroom-primary-button w-full"
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

function AdminDashboardContent({ fetcher }: { fetcher: (url: string) => Promise<any> }) {
  const { data: metrics, error } = useSWR<Metrics>('/api/admin/metrics', fetcher, {
    refreshInterval: 3000,
    revalidateOnFocus: true,
  });
  const { data: telemetry } = useSWR<TelemetryResponse>('/api/admin/telemetry', fetcher, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="shroom-admin min-h-[100dvh] p-4 text-white font-sans sm:p-8">
      <div className="max-w-5xl mx-auto">
        
        <div className="mb-8 flex flex-col items-start justify-between gap-5 sm:mb-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.location.href = '/'}
              className="shroom-header-button grid h-11 w-11 shrink-0 place-items-center rounded-xl"
              aria-label="Back to home"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="shroom-mark">
              <ShroomLogo className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">System metrics</h1>
              <p className="mt-1 text-xs font-medium text-slate-400 sm:text-sm">Live telemetry · Updated automatically</p>
            </div>
          </div>
          
          {metrics && (
            <div className="w-full text-left sm:w-auto sm:text-right">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 sm:px-4 sm:text-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Uptime: {formatUptime(metrics.uptime_seconds)}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="shroom-error mb-8">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Connection to telemetry lost. Retrying...</span>
          </div>
        )}

        {metrics ? (
          <div className="shroom-metric-grid">
            <MetricCard 
              icon={<Server className="w-6 h-6 text-blue-400" />}
              title="Go Memory"
              value={`${metrics.memory_sys_mb} MB`}
              trend={`${metrics.memory_alloc_mb} MB active · ${metrics.memory_budget_mb} MB product cap`}
            />
            <MetricCard 
              icon={<Users className="w-6 h-6 text-blue-300" />}
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
              icon={<Activity className="w-6 h-6 text-cyan-300" />}
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

        {telemetry && telemetry.reports.length > 0 && (
          <section aria-labelledby="quality-heading" className="shroom-admin-card mt-8 p-4 sm:mt-10 sm:p-6">
            <div className="mb-4 flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center sm:gap-4">
              <h2 id="quality-heading" className="text-lg font-semibold sm:text-xl">Recent call quality</h2>
              <span className="text-xs text-slate-400 sm:text-sm">Latest {telemetry.capacity} reports retained</span>
            </div>
            <div className="space-y-3 sm:hidden">
              {telemetry.reports.slice(0, 20).map((report, index) => (
                <article key={`${report.receivedAt}-mobile-${index}`} className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-sm font-semibold text-white">{report.roomId}</span>
                    <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold capitalize text-blue-200">{report.quality}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-slate-500">RTT</dt><dd className="mt-1 text-slate-200">{Math.round(report.metrics.rttMs)} ms</dd></div>
                    <div><dt className="text-slate-500">Loss</dt><dd className="mt-1 text-slate-200">{report.metrics.packetLossPercent.toFixed(1)}%</dd></div>
                    <div><dt className="text-slate-500">Route</dt><dd className="mt-1 text-slate-200">{report.metrics.candidateType || 'unknown'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-2 font-semibold">Room</th><th className="p-2 font-semibold">Quality</th><th className="p-2 font-semibold">RTT</th><th className="p-2 font-semibold">Loss</th><th className="p-2 font-semibold">Route</th></tr></thead>
                <tbody>
                  {telemetry.reports.slice(0, 20).map((report, index) => (
                    <tr key={`${report.receivedAt}-${index}`} className="border-t border-slate-800">
                      <td className="p-2 font-mono">{report.roomId}</td>
                      <td className="p-2 capitalize">{report.quality}</td>
                      <td className="p-2">{Math.round(report.metrics.rttMs)} ms</td>
                      <td className="p-2">{report.metrics.packetLossPercent.toFixed(1)}%</td>
                      <td className="p-2">{report.metrics.candidateType || 'unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, title, value, trend }: any) {
  return (
    <div className="shroom-metric-card relative overflow-hidden">
      <div className="mb-3 flex items-center justify-between sm:mb-4">
        <div className="shroom-metric-icon">
          {icon}
        </div>
      </div>
      <p className="mb-1 text-sm font-medium text-slate-400">{title}</p>
      <h3 className="break-words text-3xl font-semibold tracking-tight text-white sm:text-4xl">{value}</h3>
      <p className="mt-3 text-xs font-medium leading-5 text-slate-500">{trend}</p>
    </div>
  );
}
