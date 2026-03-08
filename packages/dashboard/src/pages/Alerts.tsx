import { Bell, AlertTriangle, PlayCircle } from 'lucide-react';

export default function Alerts() {
    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <Bell className="w-8 h-8 text-primary" />
                        Alerts & Anomalies
                    </h1>
                    <p className="text-textMuted mt-2">Configure webhook notifications for budget overruns or error spikes.</p>
                </div>
                <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                    Create Alert Rule
                </button>
            </div>

            <div className="bg-surfaceHighlight/30 border border-border border-dashed rounded-xl p-12 text-center">
                <AlertTriangle className="w-16 h-16 text-warning/50 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">No active alerts configured</h3>
                <p className="text-textMuted max-w-md mx-auto mb-6">
                    Set up alerts to get notified via Slack, Discord, or Webhook when your daily spend exceeds 90% of your budget, or if the 500-error rate spikes.
                </p>

                <div className="flex justify-center gap-4">
                    <button className="px-4 py-2 bg-surfaceHighlight hover:bg-border text-white rounded-lg font-medium transition-colors text-sm border border-border">
                        Learn about Webhooks
                    </button>
                    <button className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-lg font-medium transition-colors text-sm flex items-center gap-2">
                        <PlayCircle className="w-4 h-4" /> Setup Generic Threshold
                    </button>
                </div>
            </div>
        </div>
    );
}
