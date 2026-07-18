import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Zap, Bell, CreditCard, Terminal, Download, ArrowRight, Check, Mail } from 'lucide-react';

const LEMONSQUEEZY_CHECKOUT_URL = import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL
    || 'https://llmobserver.lemonsqueezy.com/checkout/buy/pro-monthly';
const LICENSE_SERVER_URL = import.meta.env.VITE_LICENSE_SERVER_URL
    || 'https://api.llmobserver.com';

// Razorpay checkout: collect an email (the license key is delivered there),
// ask the license server for a hosted Payment Link, then redirect.
function RazorpayCheckout() {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const start = async () => {
        setBusy(true); setError(null);
        try {
            const res = await fetch(`${LICENSE_SERVER_URL}/checkout/razorpay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Checkout failed.'); return; }
            window.location.href = data.url;
        } catch {
            setError('Could not reach the checkout service. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <button onClick={() => setOpen(true)}
                className="w-full h-12 rounded-2xl border border-white/15 text-white/80 font-semibold hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-sm">
                <CreditCard className="w-4 h-4" />
                Pay via UPI / Razorpay (INR)
            </button>
        );
    }
    return (
        <div className="w-full space-y-2">
            <div className="flex gap-2">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com" autoFocus
                    className="flex-1 h-12 rounded-2xl bg-white/5 border border-white/15 px-4 text-sm text-white outline-none focus:border-blue-500/50" />
                <button onClick={start} disabled={busy || !email.trim()}
                    className="px-5 h-12 rounded-2xl bg-blue-500 text-white font-bold text-sm hover:bg-blue-400 transition-colors disabled:opacity-50">
                    {busy ? '…' : 'Pay'}
                </button>
            </div>
            <p className="text-[11px] text-white/40">Your license key is emailed to this address after payment.</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
    );
}

// Razorpay's payment link redirects here after checkout (see CHECKOUT_CALLBACK_URL /
// callback_url in packages/license-server/api/checkout/razorpay.ts), appending its own
// razorpay_payment_link_* query params. No router library is pulled in for one static
// route — a plain pathname check is enough for a single post-payment confirmation page.
const ThanksPage: React.FC = () => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('razorpay_payment_link_status');
    const failed = status === 'cancelled' || status === 'expired';

    return (
        <div className="min-h-screen bg-[#0c0c0e] text-white flex items-center justify-center px-6">
            <div className="max-w-lg w-full text-center">
                <div className="w-16 h-16 accent-gradient rounded-2xl flex items-center justify-center mx-auto mb-8 glow">
                    {failed ? <CreditCard className="w-8 h-8 text-white" /> : <Mail className="w-8 h-8 text-white" />}
                </div>
                {failed ? (
                    <>
                        <h1 className="text-3xl font-bold mb-4">Payment not completed</h1>
                        <p className="text-white/60 mb-10 leading-relaxed">
                            Your Razorpay checkout was cancelled or expired, so no charge was made. Head back to the
                            pricing section to try again.
                        </p>
                    </>
                ) : (
                    <>
                        <h1 className="text-3xl font-bold mb-4">Thanks — you're all set.</h1>
                        <p className="text-white/60 mb-10 leading-relaxed">
                            Your payment went through. Your Pro license key is on its way to your inbox — it's emailed
                            automatically once Razorpay confirms the charge, which usually takes a few seconds and
                            occasionally a couple of minutes.
                        </p>
                        <div className="glass rounded-2xl p-6 mb-10 text-left space-y-3">
                            <p className="text-sm font-semibold text-white/80">Next steps</p>
                            <p className="text-sm text-white/50">1. Check your email for the license key.</p>
                            <p className="text-sm text-white/50">2. Run <code className="text-blue-400">npx llm-observer start</code> if you haven't already.</p>
                            <p className="text-sm text-white/50">3. Activate with <code className="text-blue-400">llm-observer activate &lt;key&gt;</code>.</p>
                        </div>
                    </>
                )}
                <a href="/" className="inline-flex items-center gap-2 px-8 h-14 rounded-2xl bg-white text-black font-bold hover:bg-white/90 transition-all">
                    <ArrowRight className="w-4 h-4 rotate-180" /> Back to LLM Observer
                </a>
                <p className="text-white/30 text-xs mt-8">
                    License key not showing up after a few minutes? Email <a href="mailto:support@llm-observer.com" className="underline hover:text-white/60">support@llm-observer.com</a>.
                </p>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    if (window.location.pathname === '/thanks') {
        return <ThanksPage />;
    }

    return (
        <div className="min-h-screen bg-[#0c0c0e] text-white selection:bg-blue-500/30">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#0c0c0e]/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 accent-gradient rounded-xl flex items-center justify-center glow">
                            <Shield className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-bold tracking-tight">LLM Observer</span>
                    </div>
                    <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
                        <a href="#features" className="hover:text-white transition-colors">Features</a>
                        <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
                        <button className="px-6 h-11 rounded-full bg-white text-black font-semibold hover:bg-white/90">
                            Get Started
                        </button>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-40 pb-20 px-6">
                <div className="max-w-7xl mx-auto text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                    >
                        <span className="px-4 py-2 rounded-full glass text-blue-400 text-sm font-semibold mb-8 inline-block border-blue-500/20">
                            Week 3 Release: v1.0.0 Now Live 🚀
                        </span>
                        <h1 className="text-6xl md:text-8xl font-extrabold tracking-tight mb-8 leading-[1.1]">
                            Privacy-First <br />
                            <span className="gradient-text tracking-tighter">LLM Intelligence.</span>
                        </h1>
                        <p className="text-xl text-white/60 max-w-2xl mx-auto mb-12 leading-relaxed">
                            The local-only proxy and dashboard for developers. Track costs, audit logs, and set budget guards without ever leaking your prompt data.
                        </p>

                        <div className="flex flex-col md:flex-row items-center justify-center gap-6 mb-20">
                            <div className="group relative">
                                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                                <button
                                    onClick={() => navigator.clipboard.writeText('npx llm-observer start')}
                                    className="relative px-8 h-16 rounded-2xl bg-white text-black font-bold text-lg flex items-center gap-3 transition-all hover:scale-[1.02]">
                                    <Terminal className="w-5 h-5" />
                                    npx llm-observer start
                                </button>
                            </div>
                            <a
                                href="https://github.com/Ranjitbehera0034/llm-observer/releases/latest"
                                target="_blank" rel="noopener noreferrer"
                                className="px-8 h-16 rounded-2xl glass font-bold text-lg flex items-center gap-3 hover:bg-white/5 border-white/10 group transition-all">
                                <Download className="w-5 h-5 text-white/60 group-hover:text-white" />
                                Download Desktop App
                            </a>
                        </div>
                    </motion.div>

                    {/* Hero Dashboard Preview */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3, duration: 0.8 }}
                        className="max-w-6xl mx-auto relative group"
                    >
                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-3xl blur-3xl opacity-50 group-hover:opacity-100 transition duration-500"></div>
                        <div className="relative glass rounded-3xl p-4 overflow-hidden shadow-2xl">
                            <div className="bg-[#151518] rounded-2xl aspect-video flex flex-col items-center justify-center border border-white/5">
                                <Shield className="w-20 h-20 text-white/5 mb-6 animate-pulse" />
                                <p className="text-white/20 font-medium">Hero Dashboard GIF Placeholder</p>
                                <p className="text-white/10 text-sm mt-2">See your LLM spend in real-time, 100% locally.</p>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* Feature Grid */}
            <section id="features" className="py-32 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {[
                            { icon: Shield, title: "100% Private", desc: "No telemetry. Your keys and logs stay on your disk." },
                            { icon: CreditCard, title: "Budget Guards", desc: "Hard limits on project spend. No surprises." },
                            { icon: Zap, title: "Unified Proxy", desc: "Switch providers by changing your baseURL." },
                            { icon: Bell, title: "Instant Alerts", desc: "Anomaly detection with webhook execution." }
                        ].map((f, i) => (
                            <motion.div
                                key={i}
                                whileHover={{ y: -5 }}
                                className="p-8 rounded-3xl glass border-white/5 hover:border-white/10 transition-colors"
                            >
                                <div className="w-12 h-12 rounded-2xl accent-gradient flex items-center justify-center mb-6">
                                    <f.icon className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                                <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Comparison */}
            <section id="pricing" className="py-32 px-6 bg-white/[0.02]">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-20">
                        <h2 className="text-4xl font-bold mb-4">Hobbyist vs Pro</h2>
                        <p className="text-white/60">Built for individuals, scaled for privacy-first teams.</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                        {/* Free Tier */}
                        <div className="p-10 rounded-[2.5rem] glass border-white/5 flex flex-col">
                            <span className="text-white/40 font-semibold mb-2 uppercase tracking-widest text-xs">Hobbyist</span>
                            <h3 className="text-3xl font-bold mb-6">Free</h3>
                            <ul className="space-y-4 mb-10 flex-grow">
                                {['1 Project', '7-day retention', 'Budget Guards', 'Local-Only'].map(f => (
                                    <li key={f} className="flex items-center gap-3 text-white/60">
                                        <Check className="w-4 h-4 text-blue-500" /> {f}
                                    </li>
                                ))}
                            </ul>
                            <button className="w-full h-14 rounded-2xl glass font-bold hover:bg-white/5 transition-colors">
                                Start for Free
                            </button>
                        </div>

                        {/* Pro Tier */}
                        <div className="p-10 rounded-[2.5rem] glass border-blue-500/20 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 px-6 py-2 accent-gradient text-xs font-bold rounded-bl-2xl">POPULAR</div>
                            <span className="text-blue-400 font-semibold mb-2 uppercase tracking-widest text-xs">Professional</span>
                            <h3 className="text-3xl font-bold mb-6">$19<span className="text-lg text-white/40">/mo</span></h3>
                            <ul className="space-y-4 mb-10 flex-grow">
                                {['Unlimited Projects', '90-day retention', 'Priority Support', 'Team Auditing (Beta)'].map(f => (
                                    <li key={f} className="flex items-center gap-3 text-white">
                                        <Check className="w-4 h-4 text-blue-500" /> {f}
                                    </li>
                                ))}
                            </ul>
                            <div className="space-y-3">
                                <a
                                    href={LEMONSQUEEZY_CHECKOUT_URL}
                                    target="_blank" rel="noopener noreferrer"
                                    className="w-full h-14 rounded-2xl bg-white text-black font-bold hover:bg-white/90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2">
                                    <ArrowRight className="w-4 h-4" />
                                    Upgrade to Pro — $19/mo
                                </a>
                                <RazorpayCheckout />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-20 border-t border-white/5">
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <p className="text-white/30 text-sm">
                        © 2026 LLM Observer. Built for developers who care about their data.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default App;
