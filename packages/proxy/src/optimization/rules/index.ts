import { m1ExpensiveSimple } from './model-selection/m1-expensive-simple';
import { m2CheapComplex } from './model-selection/m2-cheap-complex';
import { m3ProjectMismatch } from './model-selection/m3-project-mismatch';
import { m4BatchOpportunity } from './model-selection/m4-batch-opportunity';
import { c1LowCacheRate } from './context-efficiency/c1-low-cache-rate';
import { c2SessionTooLong } from './context-efficiency/c2-session-too-long';
import { c3RedundantReads } from './context-efficiency/c3-redundant-reads';
import { c4LargeInputRatio } from './context-efficiency/c4-large-input-ratio';
import { c5UnusedContext } from './context-efficiency/c5-unused-context';
import { p1ProviderArbitrage } from './provider-optimization/p1-provider-arbitrage';
import { p2SubscriptionValue } from './provider-optimization/p2-subscription-value';
import { p3PlanUpgrade } from './provider-optimization/p3-plan-upgrade';
import { w1RetryStorms } from './workflow-efficiency/w1-retry-storms';
import { w2TimeOfDay } from './workflow-efficiency/w2-time-of-day';
import { w3ProjectSprawl } from './workflow-efficiency/w3-project-sprawl';
import { w4WeekendPatterns } from './workflow-efficiency/w4-weekend-patterns';
import { a1ExpensiveExplore } from './agent-optimization/a1-expensive-explore';
import { a2TooManySubagents } from './agent-optimization/a2-too-many-subagents';
import { a3AgentDepth } from './agent-optimization/a3-agent-depth';
import { a4DuplicateAgentWork } from './agent-optimization/a4-duplicate-agent-work';

export const allRules = [
    m1ExpensiveSimple,
    m2CheapComplex,
    m3ProjectMismatch,
    m4BatchOpportunity,
    c1LowCacheRate,
    c2SessionTooLong,
    c3RedundantReads,
    c4LargeInputRatio,
    c5UnusedContext,
    p1ProviderArbitrage,
    p2SubscriptionValue,
    p3PlanUpgrade,
    w1RetryStorms,
    w2TimeOfDay,
    w3ProjectSprawl,
    w4WeekendPatterns,
    a1ExpensiveExplore,
    a2TooManySubagents,
    a3AgentDepth,
    a4DuplicateAgentWork,
];
