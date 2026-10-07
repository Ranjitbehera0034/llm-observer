-- Alerts used to copy the whole triggering request into alerts.data, prompt and
-- response bodies included. Rewrite those rows to the metadata-only shape now
-- written by the proxy, so prompts no longer outlive request retention.
UPDATE alerts
SET data = json_object(
    'request_id', json_extract(data, '$.id'),
    'project_id', json_extract(data, '$.project_id'),
    'model',      json_extract(data, '$.model'),
    'status',     json_extract(data, '$.status'),
    'cost_usd',   json_extract(data, '$.cost_usd'),
    'latency_ms', json_extract(data, '$.latency_ms')
)
WHERE data IS NOT NULL
  AND json_valid(data)
  AND json_type(data) = 'object'
  AND (json_type(data, '$.request_body') IS NOT NULL OR json_type(data, '$.response_body') IS NOT NULL);
