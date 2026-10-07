import { SessionRecord } from '@llm-observer/database';
import { SubagentRecord } from '@llm-observer/database';
import { ToolUsageRecord } from '@llm-observer/database';
import { RequestRecord } from '@llm-observer/database';
import { SubscriptionRecord } from '@llm-observer/database';
import { Budget } from '@llm-observer/database';

export type RuleCategory =
  | "model-selection"
  | "context-efficiency"
  | "provider-optimization"
  | "workflow-efficiency"
  | "agent-optimization";

export interface OptimizationResult {
  ruleId: string;
  title: string;
  description: string;
  category: RuleCategory;
  impact: "high" | "medium" | "low";
  estimatedMonthlySavings: number;
  /**
   * "measured": derived from recorded spend/usage with no assumed saving rate.
   * "heuristic": a measured cost multiplied by an assumed saving rate (an
   * estimate of what a change might save, not something observed).
   */
  basis: "measured" | "heuristic";
  /**
   * Per-session share of estimatedMonthlySavings, keyed by sessionKey(). Rules
   * whose savings are a fraction of session cost provide it so the engine can
   * count each session once across overlapping rules. Stripped by the engine
   * before results are cached or returned.
   */
  sessionSavings?: Record<string, number>;
  action: string;
  configSnippet?: string;
  dataPoints: Record<string, any>;
}

export interface RuleContext {
  /** Requested analysis window in days. */
  days: number;
  /** Days of data actually present inside the window (0 when there is none). */
  dataDays: number;
  sessions: SessionRecord[];
  subagents: SubagentRecord[];
  toolUsage: any[]; // Summary from tool_usage_daily
  usageRecords: RequestRecord[];
  roiData: { date: string; spend_usd: number }[]; // Daily spend series for the analyzed period
  budgetAlerts: any[];
  dailyCosts: any[];
  subscriptions: SubscriptionRecord[];
  /** Spend on Anthropic requests in the window (requests table). */
  anthropicSpendUsd: number;
}

export interface OptimizationRule {
  id: string;
  name: string;
  category: RuleCategory;
  /** Minimum days of data actually present before the rule may run. */
  minDataDays: number;
  /** Minimum sessions in the window before the rule may run (engine default applies when omitted). */
  minSessions?: number;
  evaluate(context: RuleContext): OptimizationResult | null;
}

/** Stable key for a session, used to attribute savings across rules. */
export function sessionKey(s: { id?: number; session_id?: string }): string {
  return String(s.id ?? s.session_id);
}
