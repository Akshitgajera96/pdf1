import mongoose from 'mongoose';

const documentAccessSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    assignedQuota: { type: Number, required: true },
    usedPrints: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'exhausted'],
      default: 'active',
      index: true,
    },
    exhaustedAt: { type: Date, default: null },
    sessionToken: { type: String, index: true, unique: true, sparse: true },
  },
  { timestamps: true }
);

const DocumentAccess =
  mongoose.models.DocumentAccess || mongoose.model('DocumentAccess', documentAccessSchema);

export default DocumentAccess;
