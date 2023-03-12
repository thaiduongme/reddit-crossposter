import { Schema, model, Types } from "mongoose";
import { FarmStage } from "../../../loaders/enums";

export interface IAccountEntity {
  username: string;
  password: string;
  email?: string;
  emailPassword?: string;
  emailVerified?: boolean;
  postKarma?: number;
  commentKarma?: number;
  awarderKarma?: number;
  totalKarma?: number;
  isNSFW?: boolean;
  cookie?: string;
  createdDate?: Date;
  profileId: string;
  lastChecked?: Date;
  status?: boolean;
  note?: string;
  using?: boolean;
  isSuspended?: boolean;
  farmStage?: FarmStage;
  nextFarmStage?: Date;
  nextFarmRun?: Date;
  lastUsed?: Date;
  postedUrls?: string[];
  commentedUrls?: string[];
  histories?: Types.ObjectId[];
  nextPost?: Date;
  nextCrosspost?: Date;
}

export const accountSchema = new Schema<IAccountEntity>({
  username: {
    type: String,
    required: true,
    maxlength: 255,
  },
  password: {
    type: String,
    required: true,
    maxlength: 255,
  },
  email: {
    type: String,
    required: false,
    maxlength: 255,
  },
  emailPassword: {
    type: String,
    required: false,
    maxlength: 255,
  },
  emailVerified: {
    type: Boolean,
    required: false,
  },
  postKarma: {
    type: Number,
    required: false,
  },
  commentKarma: {
    type: Number,
    required: false,
  },
  awarderKarma: {
    type: Number,
    required: false,
  },
  totalKarma: {
    type: Number,
    required: false,
  },
  isNSFW: {
    type: Boolean,
    required: false,
  },
  cookie: {
    type: String,
    required: false,
  },
  createdDate: {
    type: Date,
    default: Date.now,
  },
  profileId: {
    type: String,
    required: true,
  },
  lastChecked: {
    type: Date,
    required: false,
  },
  status: {
    type: Boolean,
    default: true,
  },
  note: {
    type: String,
    required: false,
  },
  using: {
    type: Boolean,
    required: false,
    default: false,
  },
  isSuspended: {
    type: Boolean,
    required: false,
    default: false,
  },
  lastUsed: {
    type: Date,
    required: false,
  },
  farmStage: {
    type: String,
    enum: FarmStage,
    required: false,
  },
  nextFarmRun: {
    type: Date,
    required: false,
  },
  nextFarmStage: {
    type: Date,
    required: false,
  },
  histories: [
    {
      type: Schema.Types.ObjectId,
      ref: "History",
    },
  ],
  nextPost: {
    type: Date,
  },
  nextCrosspost: {
    type: Date,
  },
});

export const AccountEntity = model<IAccountEntity>("Account", accountSchema);
