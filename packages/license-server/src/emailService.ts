import { Resend } from 'resend';
export interface LicenseEmailPayload {
    to: string; licenseKey: string; provider: 'lemonsqueezy' | 'razorpay';
    amount: string; currency: string; validUntil: string; portalUrl?: string; idempotencyKey: string;
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function sendLicenseEmail(p: LicenseEmailPayload): Promise<void> {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email delivery is not configured');
    const billing = p.provider === 'razorpay'
        ? 'This purchase gives you 30 days of Pro from payment. It does not auto-renew. Buy another pass when it expires.'
        : 'Manage renewal, cancellation, receipts, and payment details in your Lemon Squeezy customer portal. Cancellation keeps access through the paid period.';
    const text = `Your LLM Observer Pro license\n\n${p.licenseKey}\n\nDownload: https://github.com/Ranjitbehera0034/llm-observer/releases/latest\nOpen Settings → License & Billing, paste the key, and select Activate.\nCLI: llm-observer activate <key>\n\nCurrent access and expiry are shown in Settings → License & Billing.\n${billing}\n${p.provider === 'lemonsqueezy' ? 'Manage orders and billing: https://app.lemonsqueezy.com/my-orders' : ''}\n\nLicense recovery or a new device: keep this email and reuse the key. For help, reply with your payment reference.\nLocal usage data stays on your device. Activation and periodic entitlement checks contact our license service.\n`;
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.EMAIL_FROM, to: [p.to], subject: 'Your LLM Observer Pro license and setup instructions',
        text, html: `<div style="font:16px/1.6 system-ui;max-width:640px;margin:32px auto"><h1>Your Pro license</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(text)}</pre></div>`,
    }, { idempotencyKey: p.idempotencyKey });
    if (result.error) throw new Error('License email delivery failed');
}
