import { redactText, redactDeep } from '../piiRedaction';

describe('redactText', () => {
    it('masks an email address', () => {
        const { text, counts } = redactText('Contact me at alice@example.com about this.');
        expect(text).toBe('Contact me at [REDACTED_EMAIL] about this.');
        expect(counts.email).toBe(1);
    });

    it('masks a US phone number', () => {
        const { text, counts } = redactText('Call me at 415-555-0182 tomorrow.');
        expect(text).toContain('[REDACTED_PHONE]');
        expect(counts.phone).toBe(1);
    });

    it('masks a US SSN', () => {
        const { text, counts } = redactText('SSN: 123-45-6789');
        expect(text).toBe('SSN: [REDACTED_SSN]');
        expect(counts.ssn).toBe(1);
    });

    it('masks a valid credit card number (Luhn-checked) but not an arbitrary long digit string', () => {
        // 4111111111111111 is a well-known Luhn-valid Visa test number
        const valid = redactText('My card is 4111111111111111 expiring soon.');
        expect(valid.text).toContain('[REDACTED_CARD]');
        expect(valid.counts.credit_card).toBe(1);

        // Same length, fails Luhn — should NOT be redacted (avoids over-masking order/tracking IDs)
        const invalid = redactText('Order ID 1234567890123456 confirmed.');
        expect(invalid.text).toBe('Order ID 1234567890123456 confirmed.');
        expect(invalid.counts.credit_card).toBeUndefined();
    });

    it('masks an AWS access key', () => {
        const { text, counts } = redactText('key=AKIAABCDEFGHIJKLMNOP');
        expect(text).toContain('[REDACTED_AWS_KEY]');
        expect(counts.aws_key).toBe(1);
    });

    it('masks Anthropic and OpenAI-style API keys', () => {
        const anthropic = redactText('use sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 as the key');
        expect(anthropic.text).toContain('[REDACTED_API_KEY]');

        const openai = redactText('key: sk-abcdefghijklmnopqrstuvwxyz1234567890');
        expect(openai.text).toContain('[REDACTED_API_KEY]');
    });

    it('leaves ordinary text completely unchanged', () => {
        const input = 'Please refactor the pricing module to support Ollama.';
        const { text, counts } = redactText(input);
        expect(text).toBe(input);
        expect(Object.keys(counts)).toHaveLength(0);
    });

    it('masks multiple distinct PII types in the same string', () => {
        const { text, counts } = redactText('Email bob@corp.com or call 212-555-0100. SSN 987-65-4320.');
        expect(text).not.toContain('bob@corp.com');
        expect(text).not.toContain('212-555-0100');
        expect(text).not.toContain('987-65-4320');
        expect(counts.email).toBe(1);
        expect(counts.phone).toBe(1);
        expect(counts.ssn).toBe(1);
    });
});

describe('redactDeep', () => {
    it('redacts strings nested anywhere in an OpenAI-style messages body', () => {
        const body = {
            model: 'gpt-4o',
            stream: true,
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'My email is jane@example.com, please help.' }
            ]
        };
        const { value, counts } = redactDeep(body);
        expect(value.messages[1].content).toBe('My email is [REDACTED_EMAIL], please help.');
        expect(value.messages[0].content).toBe('You are a helpful assistant.'); // untouched
        expect(value.model).toBe('gpt-4o'); // structural fields untouched
        expect(value.stream).toBe(true);
        expect(counts.email).toBe(1);
    });

    it('redacts strings nested in Anthropic-style content-block arrays', () => {
        const body = {
            model: 'claude-sonnet-5',
            messages: [{
                role: 'user',
                content: [{ type: 'text', text: 'Call the customer at 415-555-0182.' }]
            }]
        };
        const { value, counts } = redactDeep(body);
        expect(value.messages[0].content[0].text).toContain('[REDACTED_PHONE]');
        expect(value.messages[0].content[0].type).toBe('text');
        expect(counts.phone).toBe(1);
    });

    it('is a no-op (zero counts) on a body with no sensitive data', () => {
        const body = { model: 'llama3.2', messages: [{ role: 'user', content: 'Write a haiku.' }] };
        const { value, counts } = redactDeep(body);
        expect(value).toEqual(body);
        expect(Object.keys(counts)).toHaveLength(0);
    });

    it('handles null, numbers, and booleans without throwing', () => {
        const body = { a: null, b: 42, c: true, d: undefined };
        expect(() => redactDeep(body)).not.toThrow();
    });
});
