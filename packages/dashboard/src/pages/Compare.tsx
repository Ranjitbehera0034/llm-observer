import { useState, useEffect } from 'react';
import { GitCompare, DollarSign, Clock, Hash, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { API_BASE_URL } from '../config';

type Dimension = 'model' | 'provider' | 'tags';

interface GroupStats { n: number; mean: number; stddev: number; }
interface TwoSampleComparison {
    a: GroupStats; b: GroupStats;
    deltaPct: number | null; zScore: number | null;
    significant: boolean; sufficientSample: boolean;
}
interface ProportionComparison {
    a: { n: number; successes: number; rate: number };
    b: { n: number; successes: number; rate: number };
    deltaPct: number | null; zScore: number | null;
    significant: boolean; sufficientSample: boolean;
}
interface CompareResult {
    dimension: Dimension; a: string; b: string; days: number;
    sampleSizes: { a: number; b: number };
    cost: TwoSampleComparison;
    latency: TwoSampleComparison;
    tokens: TwoSampleComparison;
    errorRate: ProportionComparison;
}

const DIMENSION_LABEL: Record<Dimension, string> = { model: 'Model', provider: 'Provider', tags: 'Tag' };

function MetricRow({ icon: Icon, label, a, b, format, lowerIsBetter = true }: {
    icon: any; label: string; a: number; b: number;
    format: (v: number) => string; lowerIsBetter?: boolean;
}) {
    const bBetter = lowerIsBetter ? b < a : b > a;
    return (
        <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
            <div className="flex items-center gap-2 text-sm text-textMuted">
                <Icon className="w-4 h-4" /> {label}
            </div>
            <div className="flex items-center gap-6 font-mono text-sm">
                <span className="text-white/70 w-24 text-right">{format(a)}</span>
                <ArrowRight className="w-3 h-3 text-white/20" />
                <span className={`w-24 text-right font-bold ${bBetter ? 'text-success' : 'text-danger'}`}>{format(b)}</span>
            </div>
        </div>
    );
}

function SignificanceBadge({ comparison }: { comparison: TwoSampleComparison | ProportionComparison }) {
    if (!comparison.sufficientSample) {
        return <span className="text-[10px] uppercase tracking-widest font-bold text-textMuted bg-white/5 px-2 py-1 rounded-md">Directional only (small sample)</span>;
    }
    if (comparison.significant) {
        return <span className="text-[10px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">Statistically significant (95%)</span>;
    }
    return <span className="text-[10px] uppercase tracking-widest font-bold text-textMuted bg-white/5 px-2 py-1 rounded-md">No significant difference</span>;
}

export default function Compare() {
    const [dimension, setDimension] = useState<Dimension>('model');
    const [options, setOptions] = useState<string[]>([]);
    const [a, setA] = useState('');
    const [b, setB] = useState('');
    const [days, setDays] = useState(30);
    const [result, setResult] = useState<CompareResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setA(''); setB(''); setResult(null); setError(null);
        fetch(`${API_BASE_URL}/api/compare/options?dimension=${dimension}`)
            .then((r) => r.json())
            .then((d) => setOptions(d.values || []))
            .catch(() => setOptions([]));
    }, [dimension]);

    const runComparison = async () => {
        if (!a || !b) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/compare?dimension=${dimension}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&days=${days}`);
            const data = await res.json();
            if (!res.ok) { setError(data.error); setResult(null); return; }
            setResult(data);
        } catch (e: any) {
            setError('Could not reach the comparison service.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-fade-in py-10 px-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/20 rounded-lg"><GitCompare className="w-6 h-6 text-primary" /></div>
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">Compare</h1>
                    <p className="text-textMuted text-sm">Head-to-head cost, latency, tokens, and error rate between two models, providers, or tags — from your own request history.</p>
                </div>
            </div>

            <div className="card flex flex-col md:flex-row items-start md:items-end gap-4">
                <div>
                    <label className="block text-xs font-bold text-textMuted uppercase tracking-widest mb-2">Compare by</label>
                    <select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}
                        className="bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                        <option value="model">Model</option>
                        <option value="provider">Provider</option>
                        <option value="tags">Tag</option>
                    </select>
                </div>
                <div className="flex-1 w-full md:w-auto">
                    <label className="block text-xs font-bold text-textMuted uppercase tracking-widest mb-2">{DIMENSION_LABEL[dimension]} A</label>
                    <select value={a} onChange={(e) => setA(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                        <option value="">Select…</option>
                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                <div className="flex-1 w-full md:w-auto">
                    <label className="block text-xs font-bold text-textMuted uppercase tracking-widest mb-2">{DIMENSION_LABEL[dimension]} B</label>
                    <select value={b} onChange={(e) => setB(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                        <option value="">Select…</option>
                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-textMuted uppercase tracking-widest mb-2">Window</label>
                    <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                        className="bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                    </select>
                </div>
                <button onClick={runComparison} disabled={!a || !b || loading}
                    className="px-6 py-2.5 rounded-lg bg-primary text-white font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 whitespace-nowrap">
                    {loading ? 'Comparing…' : 'Compare'}
                </button>
            </div>

            {error && (
                <div className="card border-danger/30 bg-danger/5 flex items-center gap-3 text-danger text-sm">
                    <AlertTriangle className="w-5 h-5 shrink-0" /> {error}
                </div>
            )}

            {result && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-3 text-sm">
                            <span className="font-bold text-white">{result.a}</span>
                            <span className="text-textMuted">({result.sampleSizes.a} requests)</span>
                            <ArrowRight className="w-4 h-4 text-white/20" />
                            <span className="font-bold text-white">{result.b}</span>
                            <span className="text-textMuted">({result.sampleSizes.b} requests)</span>
                        </div>
                        <span className="text-xs text-textMuted">Last {result.days} days</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="card">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-white text-sm">Avg. Cost per Request</h3>
                                <SignificanceBadge comparison={result.cost} />
                            </div>
                            <MetricRow icon={DollarSign} label="Mean" a={result.cost.a.mean} b={result.cost.b.mean} format={(v) => `$${v.toFixed(4)}`} />
                            {result.cost.deltaPct !== null && (
                                <p className="text-xs text-textMuted mt-2">{result.cost.deltaPct >= 0 ? '+' : ''}{result.cost.deltaPct.toFixed(1)}% change</p>
                            )}
                        </div>

                        <div className="card">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-white text-sm">Avg. Latency</h3>
                                <SignificanceBadge comparison={result.latency} />
                            </div>
                            <MetricRow icon={Clock} label="Mean" a={result.latency.a.mean} b={result.latency.b.mean} format={(v) => `${v.toFixed(0)}ms`} />
                            {result.latency.deltaPct !== null && (
                                <p className="text-xs text-textMuted mt-2">{result.latency.deltaPct >= 0 ? '+' : ''}{result.latency.deltaPct.toFixed(1)}% change</p>
                            )}
                        </div>

                        <div className="card">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-white text-sm">Avg. Total Tokens</h3>
                                <SignificanceBadge comparison={result.tokens} />
                            </div>
                            <MetricRow icon={Hash} label="Mean" a={result.tokens.a.mean} b={result.tokens.b.mean} format={(v) => v.toFixed(0)} />
                            {result.tokens.deltaPct !== null && (
                                <p className="text-xs text-textMuted mt-2">{result.tokens.deltaPct >= 0 ? '+' : ''}{result.tokens.deltaPct.toFixed(1)}% change</p>
                            )}
                        </div>

                        <div className="card">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-white text-sm">Error Rate</h3>
                                <SignificanceBadge comparison={result.errorRate} />
                            </div>
                            <MetricRow icon={AlertTriangle} label="Rate" a={result.errorRate.a.rate * 100} b={result.errorRate.b.rate * 100} format={(v) => `${v.toFixed(1)}%`} />
                        </div>
                    </div>

                    <div className="flex items-start gap-3 text-xs text-textMuted bg-white/5 rounded-xl p-4">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>
                            "Statistically significant" requires at least 30 requests on both sides and a two-sample z-test
                            crossing the 95% confidence threshold — it is a standard, disclosed statistical test, not a
                            proprietary quality score. This tool doesn't run live traffic-splitting experiments; it compares
                            history that already exists from your own usage.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
