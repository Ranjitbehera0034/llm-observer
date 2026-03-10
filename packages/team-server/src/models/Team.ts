import mongoose, { Schema, Document } from 'mongoose';

export interface ITeam extends Document {
    name: string;
    slug: string;
    owner_id: mongoose.Types.ObjectId;
    plan: 'team' | 'enterprise';
    max_seats: number;
    team_api_key: string;
    team_daily_budget?: number;
    team_monthly_budget?: number;
    alert_webhook_url?: string;
    stripe_subscription_id?: string;
    created_at: Date;
}

const TeamSchema: Schema = new Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, enum: ['team', 'enterprise'], default: 'team' },
    max_seats: { type: Number, default: 10 },
    team_api_key: { type: String, required: true, unique: true },
    team_daily_budget: { type: Number },
    team_monthly_budget: { type: Number },
    alert_webhook_url: { type: String },
    stripe_subscription_id: { type: String },
    created_at: { type: Date, default: Date.now }
});

export default mongoose.model<ITeam>('Team', TeamSchema);
