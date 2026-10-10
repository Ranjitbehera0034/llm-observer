/**
 * What the Team tier sends off this machine, and what it never does. This is the single source for the
 * Team page's privacy statement; it mirrors the sync payload in packages/proxy/src/syncManager.ts
 * (pushAggregates) and docs/guide/team.md. Change them together.
 */
export const SENT_TO_TEAM_SERVER = [
    'The day (date)',
    'Provider and model names',
    'The project name',
    'Request, token and cost totals for that day',
    'Error and blocked-request counts and the average latency',
    'Your email address (the one you were invited with)',
] as const;

export const NEVER_SENT = [
    'Prompts',
    'Responses',
    'File paths',
    'Sessions or conversation content',
    'Your provider API keys',
] as const;

export const PRIVACY_SUMMARY =
    'Once you have joined a team and have a Team licence, this app sends your team server one row per day, provider, model and project: ' +
    'the date, provider, model, project name, request, token and cost totals, error and blocked counts, average latency, and your email address. ' +
    'It never sends prompts, responses, file paths or sessions. Everything else stays in the local database on this machine.';
