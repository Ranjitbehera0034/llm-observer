import mongoose, { Schema, Document } from 'mongoose';

export type PolicyScope = 'daily' | 'weekly' | 'monthly';
export type PolicyAction = 'alert' | 'block';

export interface IPolicyBudget {
    scope: PolicyScope;
    limitUsd: number;
    /** Lower-case provider name; absent means "all providers". */
    provider?: string;
    action: PolicyAction;
}

/**
 * One document per team: the budget policy the members' apps fetch. The policy is advice the
 * app enforces locally; the server never sees prompts and does not enforce anything itself.
 * `version` starts at 1 on the first save and increases on every save.
 */
export interface ITeamPolicy extends Document {
    team_id: mongoose.Types.ObjectId;
    version: number;
    budgets: IPolicyBudget[];
    /** Email of the admin who saved this version (from their session). */
    updated_by?: string;
    updated_at: Date;
}

const BudgetSchema = new Schema<IPolicyBudget>({
    scope: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
    limitUsd: { type: Number, required: true },
    provider: { type: String },
    action: { type: String, enum: ['alert', 'block'], required: true }
}, { _id: false });

const TeamPolicySchema: Schema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true, unique: true },
    version: { type: Number, default: 0 },
    budgets: { type: [BudgetSchema], default: [] },
    updated_by: { type: String },
    updated_at: { type: Date, default: Date.now }
});

export default mongoose.model<ITeamPolicy>('TeamPolicy', TeamPolicySchema);
