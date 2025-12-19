import mongoose from 'mongoose';

const offlineTokenSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  documentAccessId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentAccess', required: true, index: true },
  machineGuidHash: { type: String, required: true, index: true },
  printerName: { type: String, required: true },
  printerType: { type: String, default: null },
  portName: { type: String, default: null },
  clientOS: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  reconciledAt: { type: Date, default: null },
}, { timestamps: true });

offlineTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('OfflineToken', offlineTokenSchema);
