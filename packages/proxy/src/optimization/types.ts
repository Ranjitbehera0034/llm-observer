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
  action: string;
  configSnippet?: string;
  dataPoints: Record<string, any>;
}

export interface RuleContext {
  days: number;
  sessions: SessionRecord[];
  subagents: SubagentRecord[];
  toolUsage: any[]; // Summary from tool_usage_daily
  usageRecords: RequestRecord[];
  roiData: any[]; // To be implemented or fetched from stats
  budgetAlerts: any[];
  dailyCosts: any[];
  subscriptions: SubscriptionRecord[];
}

export interface OptimizationRule {
  id: string;
  name: string;
  category: RuleCategory;
  minDataDays: number;
  evaluate(context: RuleContext): OptimizationResult | null;
}
