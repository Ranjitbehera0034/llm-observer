import { handleWebhook } from '../../src/webhook.js';
export default { fetch: (req: Request) => handleWebhook(req, 'razorpay') };
