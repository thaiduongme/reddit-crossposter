import { Document, HydratedDocument, Types } from "mongoose";
import { SubredditUsedFor } from "../../loaders/enums";
import { ISubredditEntity, SubredditEntity } from "./entities/subreddit.entity";
import { ISubredditDB } from "./interfaces/subreddit-db.interface";

export class PostSubredditDB implements ISubredditDB {
  private currentSubreddit: HydratedDocument<ISubredditEntity>;
  constructor(private readonly hoursPerPost: number) {}

  async startUsing(): Promise<HydratedDocument<ISubredditEntity>> {
    const currentSubreddit = await SubredditEntity.findOneAndUpdate(
      {
        $and: [
          {
            $or: [{ using: false }, { using: { $exists: false } }],
          },
          {
            $or: [
              {
                nextPost: {
                  $exists: false,
                },
              },
              {
                nextPost: { $lte: new Date() },
              },
            ],
          },
        ],
        status: true,
        usedFor: SubredditUsedFor.MONETIZATION,
      },
      {
        using: true,
        lastUsed: new Date(),
      }
    ).sort({ lastUsed: 1 });
    this.currentSubreddit = currentSubreddit;
    return this.currentSubreddit;
  }

  async endUsing(): Promise<void> {
    if (!this.currentSubreddit) {
      throw new Error(`[PostSubredditDB] Must start using before end using`);
    }
    const nextPost = new Date();
    nextPost.setHours(nextPost.getHours() + this.hoursPerPost);
    await SubredditEntity.updateOne(
      { _id: this.currentSubreddit._id },
      { using: false, lastUsed: new Date(), nextPost: nextPost }
    );

    this.currentSubreddit = null;
  }
}
