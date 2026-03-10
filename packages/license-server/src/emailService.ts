import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'licenses@llmobserver.com';

export interface LicenseEmailPayload {
    to: string;
    licenseKey: string;
    provider: 'lemonsqueezy' | 'razorpay';
    amount: string;
    currency: string;
}

/**
 * Sends the Pro license key email to the customer via Resend.
 *
 * Resend free tier: 100 emails/day, 3,000/month — more than enough for launch.
 * Get your key at: https://resend.com
 */
export async function sendLicenseEmail(payload: LicenseEmailPayload): Promise<void> {
    const { to, licenseKey, provider, amount, currency } = payload;

    const providerLabel = provider === 'razorpay' ? 'Razorpay / UPI' : 'Lemon Squeezy';
    const flagEmoji = currency === 'INR' ? '🇮🇳' : '🌍';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your LLM Observer Pro License</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Inter',system-ui,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:48px auto;">
    <tr>
      <td style="padding:40px;background:#1a1d2e;border-radius:16px;border:1px solid #2d3748;">

        <!-- Header -->
        <div style="margin-bottom:32px;text-align:center;">
          <div style="display:inline-block;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:12px;padding:12px 24px;">
            <span style="font-size:28px;">🚀</span>
            <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#fff;">You're now Pro!</h1>
            <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">LLM Observer Pro License</p>
          </div>
        </div>

        <!-- Key Block -->
        <div style="margin:28px 0;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Your License Key</p>
          <div style="background:#0f1117;border:1px solid #7c3aed60;border-radius:10px;padding:20px 24px;text-align:center;">
            <code style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;color:#a78bfa;letter-spacing:2px;word-break:break-all;">${licenseKey}</code>
          </div>
          <p style="margin:10px 0 0;font-size:11px;color:#64748b;text-align:center;">Keep this key safe. It unlocks Pro on any installation.</p>
        </div>

        <!-- Activation Steps -->
        <div style="background:#0f1117;border-radius:10px;border:1px solid #2d3748;padding:20px 24px;margin:20px 0;">
          <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#fff;">How to activate:</p>
          <ol style="margin:0;padding-left:20px;color:#94a3b8;font-size:13px;line-height:1.9;">
            <li>Open LLM Observer → <strong style="color:#e2e8f0;">Settings</strong></li>
            <li>Click the <strong style="color:#e2e8f0;">License & Billing</strong> tab</li>
            <li>Scroll down to <strong style="color:#e2e8f0;">"Already have a key?"</strong></li>
            <li>Paste your key and click <strong style="color:#e2e8f0;">Activate License</strong></li>
          </ol>
        </div>

        <!-- What you unlocked -->
        <div style="margin:20px 0;">
          <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">What you unlocked</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${['Unlimited Local Projects', '90-Day Log Retention', 'Full Cost Optimizer', 'Priority Feature Updates'].map(f => `
            <tr>
              <td style="padding:6px 0;">
                <span style="display:inline-block;background:#10b98120;border-radius:20px;padding:3px 12px;font-size:13px;color:#34d399;">✓ ${f}</span>
              </td>
            </tr>`).join('')}
          </table>
        </div>

        <!-- Payment Info -->
        <div style="border-top:1px solid #2d3748;margin-top:28px;padding-top:20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#64748b;">
            <tr>
              <td>${flagEmoji} Paid via ${providerLabel}</td>
              <td style="text-align:right;">${currency} ${amount}</td>
            </tr>
            <tr>
              <td style="padding-top:6px;">Questions? Reply to this email.</td>
              <td style="text-align:right;padding-top:6px;"><a href="https://llmobserver.com" style="color:#7c3aed;text-decoration:none;">llmobserver.com</a></td>
            </tr>
          </table>
        </div>

      </td>
    </tr>
    <tr>
      <td style="text-align:center;padding:20px;font-size:11px;color:#334155;">
        LLM Observer · Privacy-First AI Proxy · 100% Local
      </td>
    </tr>
  </table>
</body>
</html>`;

    const { error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: `🗝️ Your LLM Observer Pro License Key`,
        html,
    });

    if (error) {
        console.error('[EMAIL] Resend error:', error);
        throw new Error(`Failed to send license email: ${error.message}`);
    }

    console.log(`[EMAIL] ✅ License key sent to ${to.split('@')[0]}@***`);
}
