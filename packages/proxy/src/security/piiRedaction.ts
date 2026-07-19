/**
 * Best-effort PII redaction for outbound requests.
 *
 * Scans request bodies for common sensitive-data patterns (emails, phone
 * numbers, SSNs, credit card numbers, API keys) and masks them BEFORE the
 * request leaves this machine for a model provider. This is regex-based
 * pattern matching, not a compliance-grade DLP system — it catches common
 * cases, not everything, and can have false negatives on obfuscated or
 * unusual formats. Off by default (see `pii_redaction_enabled` setting);
 * enabling it modifies the user's actual prompt content, so it must be an
 * explicit opt-in, never a silent default.
 */

interface Detector {
    name: string;
    pattern: RegExp;
    /** Extra check beyond the regex (e.g. Luhn checksum) to cut false positives */
    validate?: (rawMatch: string) => boolean;
    replacement: string;
}

const luhnValid = (digits: string): boolean => {
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alternate) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
        alternate = !alternate;
    }
    return sum % 10 === 0;
};

const DETECTORS: Detector[] = [
    {
        name: 'email',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: '[REDACTED_EMAIL]'
    },
    {
        name: 'credit_card',
        pattern: /\b(?:\d[ -]?){13,19}\b/g,
        validate: (m) => {
            const digits = m.replace(/[ -]/g, '');
            return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
        },
        replacement: '[REDACTED_CARD]'
    },
    {
        name: 'ssn',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
        replacement: '[REDACTED_SSN]'
    },
    {
        name: 'phone',
        pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
        replacement: '[REDACTED_PHONE]'
    },
    {
        name: 'aws_key',
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
        replacement: '[REDACTED_AWS_KEY]'
    },
    {
        name: 'api_key',
        // Known-provider token prefixes with a long opaque suffix
        pattern: /\b(?:sk-ant-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{20,})\b/g,
        replacement: '[REDACTED_API_KEY]'
    }
];

export function redactText(text: string): { text: string; counts: Record<string, number> } {
    let result = text;
    const counts: Record<string, number> = {};
    for (const detector of DETECTORS) {
        result = result.replace(detector.pattern, (match) => {
            if (detector.validate && !detector.validate(match)) return match;
            counts[detector.name] = (counts[detector.name] || 0) + 1;
            return detector.replacement;
        });
    }
    return { text: result, counts };
}

/** Recursively redacts every string value in an arbitrary JSON-like structure. */
export function redactDeep<T = any>(value: T): { value: T; counts: Record<string, number> } {
    const totalCounts: Record<string, number> = {};

    const merge = (counts: Record<string, number>) => {
        for (const [k, n] of Object.entries(counts)) {
            totalCounts[k] = (totalCounts[k] || 0) + n;
        }
    };

    const walk = (v: any): any => {
        if (typeof v === 'string') {
            const { text, counts } = redactText(v);
            merge(counts);
            return text;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out: Record<string, any> = {};
            for (const [k, val] of Object.entries(v)) out[k] = walk(val);
            return out;
        }
        return v;
    };

    return { value: walk(value), counts: totalCounts };
}
