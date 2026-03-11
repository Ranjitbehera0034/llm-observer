import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { updateSetting } from '@llm-observer/database';
import { activateLicenseFromPayment } from '../licenseManager';
import '../types';

export const webhooksRouter = Router();

/**
 * POST /api/webhooks/lemonsqueezy
 * Handles subscription_created and subscription_payment_success events.
 * Validates the Lemon Squeezy HMAC-SHA256 signature header.
 */
webhooksRouter.post('/lemonsqueezy', express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; }
}), async (req, res) => {
    try {
        const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        if (!secret) {
            console.error('[WEBHOOK] LEMONSQUEEZY_WEBHOOK_SECRET is not set. Set this env var to accept webhooks.');
            return res.status(503).json({ error: 'Webhook endpoint not configured. Set LEMONSQUEEZY_WEBHOOK_SECRET.' });
        }

        const sig = req.headers['x-signature'] as string;
        if (!sig) return res.status(401).json({ error: 'Missing signature header' });

        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(req.rawBody!);
        const expected = hmac.digest('hex');

        // Guard against RangeError: timingSafeEqual requires equal-length buffers
        const sigBuf = Buffer.from(sig, 'hex');
        const expectedBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const event = req.headers['x-event-name'] as string;
        const body = req.body;

        const activatableEvents = ['subscription_created', 'subscription_payment_success', 'order_created'];
        const deactivatableEvents = ['subscription_cancelled', 'subscription_expired', 'subscription_paused'];

        if (deactivatableEvents.includes(event)) {
            updateSetting('license_key', '');
            updateSetting('license_status', 'cancelled');
            console.log(`[LICENSE] Subscription cancelled via LemonSqueezy webhook (event: ${event})`);
            return res.json({ received: true, action: 'deactivated' });
        }

        if (!activatableEvents.includes(event)) {
            return res.json({ received: true, action: 'ignored' });
        }

        const attrs = body?.data?.attributes;
        const subscriptionId = String(body?.data?.id || 'unknown');
        const customerId = String(attrs?.customer_id || attrs?.user_email || 'unknown');
        const amountCents = attrs?.total || attrs?.first_subscription_item?.price || 0;
        const currency = attrs?.currency || 'USD';

        const result = activateLicenseFromPayment({
            provider: 'lemonsqueezy',
            subscriptionId,
            customerId,
            amountCents,
            currency,
            event
        });

        res.json({ received: true, activated: result.success });
    } catch (err) {
        console.error('[WEBHOOK] Lemon Squeezy error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * POST /api/webhooks/razorpay
 * Handles subscription.activated and payment.captured events from Razorpay.
 * Validates the X-Razorpay-Signature header.
 */
webhooksRouter.post('/razorpay', express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; }
}), async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            console.error('[WEBHOOK] RAZORPAY_WEBHOOK_SECRET is not set. Set this env var to accept webhooks.');
            return res.status(503).json({ error: 'Webhook endpoint not configured. Set RAZORPAY_WEBHOOK_SECRET.' });
        }

        const sig = req.headers['x-razorpay-signature'] as string;
        if (!sig) return res.status(401).json({ error: 'Missing signature header' });

        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(req.rawBody!);
        const expected = hmac.digest('hex');

        // Guard against RangeError: timingSafeEqual requires equal-length buffers
        const sigBuf = Buffer.from(sig, 'hex');
        const expectedBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const event = req.body?.event as string;
        const payload = req.body?.payload;

        const activatableEvents = ['subscription.activated', 'subscription.charged', 'payment.captured'];
        const deactivatableEvents = ['subscription.cancelled', 'subscription.halted', 'subscription.paused'];

        if (deactivatableEvents.includes(event)) {
            updateSetting('license_key', '');
            updateSetting('license_status', 'cancelled');
            console.log(`[LICENSE] Subscription cancelled via Razorpay webhook (event: ${event})`);
            return res.json({ received: true, action: 'deactivated' });
        }

        if (!activatableEvents.includes(event)) {
            return res.json({ received: true, action: 'ignored' });
        }

        const subscription = payload?.subscription?.entity || {};
        const payment = payload?.payment?.entity || {};

        const subscriptionId = subscription.id || payment.order_id || 'unknown';
        const customerId = subscription.customer_id || payment.email || 'unknown';
        const amountCents = subscription.amount || payment.amount || 0;
        const currency = subscription.currency || payment.currency || 'INR';

        const result = activateLicenseFromPayment({
            provider: 'razorpay',
            subscriptionId,
            customerId,
            amountCents,
            currency,
            event
        });

        res.json({ received: true, activated: result.success });
    } catch (err) {
        console.error('[WEBHOOK] Razorpay error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
