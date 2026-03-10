import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    name: string;
    avatar_url?: string;
    stripe_customer_id?: string;
    created_at: Date;
}

const UserSchema: Schema = new Schema({
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    avatar_url: { type: String },
    stripe_customer_id: { type: String },
    created_at: { type: Date, default: Date.now }
});

export default mongoose.model<IUser>('User', UserSchema);
