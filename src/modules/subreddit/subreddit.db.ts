import {
  SubredditUsedFor,
  SubredditType,
  PostType,
  SubredditPostType,
} from "../../loaders/enums";
import { ISubredditEntity, SubredditEntity } from "./entities/subreddit.entity";
import { HydratedDocument } from "mongoose";

export class SubredditDB {
  constructor() {}

  async getSubredditByName(
    name: string
  ): Promise<HydratedDocument<ISubredditEntity>> {
    return await SubredditEntity.findOne({
      name: { $regex: new RegExp("^" + name.toLowerCase(), "i") },
    });
  }

  async getSubredditToCrosspost(): Promise<HydratedDocument<ISubredditEntity>> {
    return await SubredditEntity.findOneAndUpdate(
      {
        status: true,
        usedFor: SubredditUsedFor.MONETIZATION,
      },
      {
        $inc: {
          numUses: 1,
        },
      }
    ).sort({ numUses: 1 });
  }

  async getSubredditToCrosspostTo(
    subreddit: ISubredditEntity
  ): Promise<HydratedDocument<ISubredditEntity>> {
    const orExpression = [
      {
        allowedContents: {
          $elemMatch: {
            $regex: "general",
            $options: "i",
          },
        },
      },
    ];
    for (const allowedContent of subreddit.allowedContents) {
      orExpression.push({
        allowedContents: {
          $elemMatch: {
            $regex: allowedContent,
            $options: "i",
          },
        },
      });
    }
    const andExpression = [
      {
        allowedPostTypes: {
          $elemMatch: {
            $regex: SubredditPostType.LINK,
            $options: "i",
          },
        },
      },
      {
        allowedPostTypes: {
          $elemMatch: {
            $regex: SubredditPostType.VIDEO,
            $options: "i",
          },
        },
      },
    ];

    return await SubredditEntity.findOneAndUpdate(
      {
        status: true,
        usedFor: SubredditUsedFor.MULTI_PURPOSE,
        crosspostable: true,
        type: SubredditType.PUBLIC,
        $and: andExpression,
        $or: orExpression,
      },
      {
        $inc: {
          numUses: 1,
        },
      }
    ).sort({ numUses: 1 });
  }
}
