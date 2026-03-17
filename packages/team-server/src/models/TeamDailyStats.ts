import mongoose, { Schema, Document } from 'mongoose';

export interface ITeamDailyStats extends Document {
    team_id: mongoose.Types.ObjectId;
    member_id: mongoose.Types.ObjectId;
    date: Date;
    provider: string;
    llm_model: string;
    project_name: string;
    total_requests: number;
    total_tokens: number;
    total_cost_usd: number;
    avg_latency_ms: number;
    error_count: number;
    blocked_count: number;
    created_at: Date;
}

const TeamDailyStatsSchema: Schema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    member_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    provider: { type: String, required: true },
    llm_model: { type: String, required: true },
    project_name: { type: String, required: true },
    total_requests: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    total_cost_usd: { type: Number, default: 0 },
    avg_latency_ms: { type: Number, default: 0 },
    error_count: { type: Number, default: 0 },
    blocked_count: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

// Compound index for fast aggregation and uniqueness per day/member/model
TeamDailyStatsSchema.index({ team_id: 1, member_id: 1, date: 1, provider: 1, llm_model: 1, project_name: 1 }, { unique: true });

export default mongoose.model<ITeamDailyStats>('TeamDailyStats', TeamDailyStatsSchema);
