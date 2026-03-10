import mongoose from 'mongoose';

const JobSchema = new mongoose.Schema(
  {
    excelRowIndex: { type: Number },
    videoId: { type: String },
    titleFromExcel: { type: String },
    label: { type: String },
    acronym: { type: String, required: true },
    matchBy: { type: String, enum: ['id', 'title', 'both'], required: true },

    oldTitle: { type: String },
    newTitle: { type: String },

    status: {
      type: String,
      enum: ['pending', 'updated', 'skipped', 'failed'],
      default: 'pending',
      index: true
    },
    errorMessage: { type: String },

    processedAt: { type: Date },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DryRunSession' }
  },
  {
    timestamps: true
  }
);

JobSchema.index({ createdAt: 1 });
JobSchema.index({ processedAt: 1 });

const Job = mongoose.model('Job', JobSchema);
export default Job;

