import mongoose, { Schema } from 'mongoose';

const userSchema = new Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true });

const kitSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  companyUrl: { type: String, required: true },
  jobDescription: { type: String, required: true },
  daysAvailable: { type: Number, required: true, min: 1, max: 60 },
  status: { type: String, enum: ['draft', 'generating', 'ready', 'failed'], default: 'draft' },
  generationProgress: { type: String, default: '' },
  generationError: { type: String, default: '' },
  regeneration: {
    status: { type: String, enum: ['idle', 'generating', 'failed'], default: 'idle' },
    section: { type: String, default: '' },
    category: { type: String, default: '' },
    progress: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  sourceGaps: { type: [Schema.Types.Mixed], default: [] },
  generatedKit: { type: Schema.Types.Mixed, default: null },
  // Keyed by flashcard id; kept separate from generatedKit so practice never changes draft content.
  practiceProgress: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Kit = mongoose.models.Kit || mongoose.model('Kit', kitSchema);
