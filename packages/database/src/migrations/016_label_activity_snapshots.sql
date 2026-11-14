-- Session counts are observations of activity, not provider quota usage.
UPDATE rate_limit_snapshots SET window_type = 'activity_5h'
WHERE provider = 'anthropic' AND window_type = '5h' AND is_estimated = 1;
