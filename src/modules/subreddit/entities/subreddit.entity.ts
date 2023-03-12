import { Schema, model } from "mongoose";
import {
  SubredditPostType,
  SubredditType,
  SubredditUsedFor,
} from "../../../loaders/enums";

export interface ISubredditEntity {
  name: string;
  title: string;
  description: string;
  crosspostable: boolean;
  subscribers: number;
  allowedPostTypes: SubredditPostType[];
  lowestKarma?: number;
  isNSFW: boolean;
  allowedContents: string[];
  isVerificationRequired: boolean;
  usedFor: SubredditUsedFor;
  numUses: number;
  status: boolean;
  type: SubredditType;
  nextPost?: Date;
  using?: boolean;
  lastUsed?: Date;
}

export const subredditSchema = new Schema<ISubredditEntity>({
  name: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^r\/[a-zA-Z0-9_-]+$/.test(v);
      },
      message: (props) => `${props.value} is not a valid subreddit name`,
    },
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  subscribers: {
    type: Number,
    required: true,
  },
  allowedPostTypes: {
    type: [String],
    enum: SubredditPostType,
    required: true,
  },
  lowestKarma: {
    type: Number,
    required: false,
  },
  isNSFW: {
    type: Boolean,
    required: true,
  },
  allowedContents: {
    type: [String],
    required: true,
    default: [],
  },
  isVerificationRequired: {
    type: Boolean,
    default: false,
  },
  usedFor: {
    type: String,
    enum: SubredditUsedFor,
    default: SubredditUsedFor.MULTI_PURPOSE,
  },
  numUses: {
    type: Number,
    required: false,
    default: 0,
  },
  status: {
    type: Boolean,
    default: true,
  },
  type: {
    type: String,
    enum: SubredditType,
    default: SubredditType.PUBLIC,
  },
  nextPost: {
    type: Date,
  },
  using: {
    type: Boolean,
    default: false,
  },
  lastUsed: {
    type: Date,
  },
});

export const SubredditEntity = model<ISubredditEntity>(
  "Subreddit",
  subredditSchema
);
