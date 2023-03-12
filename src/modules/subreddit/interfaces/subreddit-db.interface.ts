import { HydratedDocument } from "mongoose";
import { ISubredditEntity } from "../entities/subreddit.entity";

export interface ISubredditDB {
  startUsing(): Promise<HydratedDocument<ISubredditEntity>>;
  endUsing(): Promise<void>;
}
