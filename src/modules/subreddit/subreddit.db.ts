import {
  SubredditUsedFor,
  SubredditType,
  PostType,
  SubredditPostType,
} from "../../loaders/enums";
import { ISubredditEntity, SubredditEntity } from "./entities/subreddit.entity";
import { HydratedDocument } from "mongoose";
import { HistoryEntity } from "../history/entities/history.entity";

export class SubredditDB {
  constructor() {}

  async getSubredditByName(
    name: string
  ): Promise<HydratedDocument<ISubredditEntity>> {
    return await SubredditEntity.findOne({
      name: { $regex: new RegExp("^" + name.toLowerCase(), "i") },
    });
  }

  async getSubredditToCrosspostToByPostId(
    postId: string
  ): Promise<HydratedDocument<ISubredditEntity>> {
    const postHistory = await HistoryEntity.findOne({ postId: postId });
    if (
      !postHistory ||
      !postHistory?.tags?.length ||
      postHistory?.tags?.length == 0
    ) {
      return null;
    }
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
    for (const tag of postHistory.tags) {
      orExpression.push({
        allowedContents: {
          $elemMatch: {
            $regex: "^" + tag + "$",
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

    const targetSubreddit = await SubredditEntity.findOneAndUpdate(
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

    if (!targetSubreddit?.numUses) {
      targetSubreddit.numUses = 1;
      await targetSubreddit.save();
    }

    return targetSubreddit;
  }

  async getSubredditToCrosspost(): Promise<HydratedDocument<ISubredditEntity>> {
    const targetSubreddit = await SubredditEntity.findOneAndUpdate(
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

    if (!targetSubreddit?.numUses) {
      targetSubreddit.numUses = 1;
      await targetSubreddit.save();
    }

    return targetSubreddit;
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

    const targetSubreddit = await SubredditEntity.findOneAndUpdate(
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

    if (!targetSubreddit?.numUses) {
      targetSubreddit.numUses = 1;
      await targetSubreddit.save();
    }

    return targetSubreddit;
  }
}
