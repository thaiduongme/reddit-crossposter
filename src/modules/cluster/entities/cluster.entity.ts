import { Schema, model, Types } from "mongoose";
import { BotType } from "../../../loaders/enums";

export interface IClusterEntity {
  botType: BotType;
  ip: string;
  clusterId: number;
  currentLog: string;
  updatedAt: Date;
  createdAt: Date;
}

export const clusterSchema = new Schema<IClusterEntity>({
  botType: {
    type: String,
    enum: BotType,
    required: true,
  },
  ip: {
    type: String,
    required: true,
  },
  clusterId: {
    type: Number,
    required: true,
  },
  currentLog: {
    type: String,
  },
  updatedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

clusterSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export const ClusterEntity = model<IClusterEntity>("Cluster", clusterSchema);
