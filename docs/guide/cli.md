# CLI Reference

Complete reference for all `llm-observer` CLI commands.

## Quick Reference

```bash
llm-observer start          # Start proxy (port 4000) + dashboard (port 4001)
llm-observer stop           # Stop all services
llm-observer status         # Check what's running
llm-observer stats          # Show today's cost summary
llm-observer logs           # Live-tail request log
llm-observer upgrade        # Open upgrade checkout
llm-observer activate <key> # Activate Pro license
llm-observer team join <key># Join a team
```

## Commands

### `start`
Start the proxy server and dashboard.
```bash
llm-observer start
llm-observer start --proxy-port 4000 --dashboard-port 4001
```

### `stop`
Stop all running LLM Observer processes.
```bash
llm-observer stop
```

### `status`
Show running service status and current plan.
```bash
llm-observer status
```

### `stats`
Show cost summary for today (or a date range).
```bash
llm-observer stats
llm-observer stats --days 7
llm-observer stats --project my-project
```

### `logs`
Live tail the request log.
```bash
llm-observer logs
llm-observer logs --provider openai
llm-observer logs --limit 50
```

### `projects`
Manage projects.
```bash
llm-observer projects list
llm-observer projects create "My App" --budget 10.00
llm-observer projects delete <id>
```

### `budget`
Set or view budget for a project.
```bash
llm-observer budget set <project-id> --daily 10.00
llm-observer budget get <project-id>
```

### `upgrade`
Open checkout to upgrade to Pro or Team.
```bash
llm-observer upgrade                    # Pro monthly ($19)
llm-observer upgrade --plan pro-yearly  # Pro yearly ($190)
llm-observer upgrade --plan team        # Team ($49/seat)
llm-observer upgrade --india            # Razorpay (₹1,499/month)
```

### `activate`
Activate a Pro license key received after payment.
```bash
llm-observer activate PRO_your-key-here
```

### `team`
Manage team cloud synchronization.
```bash
llm-observer team join <team-api-key> --email you@company.com
llm-observer team status
llm-observer team sync
```

### `export`
Export request logs to CSV.
```bash
llm-observer export --days 30 --output report.csv
```

### `config`
View or set configuration.
```bash
llm-observer config get proxy_port
llm-observer config set proxy_port 4000
```

### `audit`
View alerts and anomaly history.
```bash
llm-observer audit
llm-observer audit --type budget_exceeded
```
