import { Schema, model } from "mongoose";
import { PostSource, SubredditPostType } from "../../../loaders/enums";

export interface IPostEntity {
  title: string;
  description?: string;
  type: SubredditPostType;
  link?: string;
  tags: string[];
  numUses?: number;
  siteSource?: PostSource;
  subredditSource?: string;
}

export const postSchema = new Schema<IPostEntity>({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: false,
  },
  type: {
    type: String,
    enum: SubredditPostType,
    required: true,
  },
  link: {
    type: String,
    required: false,
  },
  tags: { type: [String], default: [] },
  numUses: {
    type: Number,
    default: 0,
  },
  siteSource: {
    type: String,
    enum: PostSource,
  },
  subredditSource: {
    type: String,
    required: false,
  },
});

export const PostEntity = model<IPostEntity>("Post", postSchema);
