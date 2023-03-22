import { Schema, model, Types } from "mongoose";
import { HistoryAction } from "../../../loaders/enums";

export interface IHistoryEntity {
  action: HistoryAction;
  postId: string;
  author: Types.ObjectId;
  createdDate?: Date;
  targetSubreddit?: string;
  status: boolean;
  tags?: string[];
}

export const historySchema = new Schema<IHistoryEntity>({
  action: {
    type: String,
    enum: HistoryAction,
    required: true,
  },
  postId: {
    type: String,
    required: true,
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: "Account",
  },
  createdDate: {
    type: Date,
    required: false,
    default: Date.now,
  },
  targetSubreddit: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^r\/[a-zA-Z0-9_-]+$/.test(v);
      },
      message: (props) => `${props.value} is not a valid subreddit name`,
    },
  },
  status: {
    type: Boolean,
    default: true,
  },
  tags: {
    type: [String],
    default: [],
  },
});

export const HistoryEntity = model<IHistoryEntity>("History", historySchema);
