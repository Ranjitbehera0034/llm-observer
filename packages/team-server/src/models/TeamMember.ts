import mongoose, { Schema, Document } from 'mongoose';

export type TeamMemberRole = 'owner' | 'admin' | 'member';

export interface ITeamMember extends Document {
    team_id: mongoose.Types.ObjectId;
    /** Set once the invited person actually signs in (local or OIDC). Null while an invite is pending. */
    user_id?: mongoose.Types.ObjectId;
    role: TeamMemberRole;
    invited_email: string;
    invited_at: Date;
    joined_at?: Date;
}

const TeamMemberSchema: Schema = new Schema({
    team_id: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    invited_email: { type: String, required: true, lowercase: true, trim: true },
    invited_at: { type: Date, default: Date.now },
    joined_at: { type: Date }
});

// A given email can only be invited once per team
TeamMemberSchema.index({ team_id: 1, invited_email: 1 }, { unique: true });

export default mongoose.model<ITeamMember>('TeamMember', TeamMemberSchema);
