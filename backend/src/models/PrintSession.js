import mongoose from 'mongoose';

const printSessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    documentAccessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentAccess',
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true },
    fetchedAt: { type: Date, default: null },
    fetchCount: { type: Number, default: 0, min: 0 },
    usedAt: { type: Date, default: null },
    printerName: { type: String, default: null },
    printerType: { type: String, default: null },
    portName: { type: String, default: null },
    clientOS: { type: String, default: null },
  },
  { timestamps: true }
);

printSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });


const PrintSession =
  mongoose.models.PrintSession || mongoose.model('PrintSession', printSessionSchema);

export default PrintSession;
