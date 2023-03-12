import { ISubredditEntity } from "../subreddit/entities/subreddit.entity";
import { IPostEntity, PostEntity } from "./entities/post.entity";

export class PostDB {
  constructor() {}

  async getPostForSubreddit(subreddit: ISubredditEntity): Promise<IPostEntity> {
    const orExpression: any[] = [];
    if (
      subreddit.allowedContents.length > 0 &&
      subreddit.allowedContents[0] != "general"
    ) {
      for (const tag of subreddit.allowedContents) {
        orExpression.push({
          tags: {
            $elemMatch: { $regex: tag, $options: "i" },
          },
        });
      }
      const filter: any = {};
      if (orExpression.length != 0) {
        filter.$or = orExpression;
      }
      return await PostEntity.findOneAndUpdate(
        filter,
        {
          $inc: {
            numUses: 1,
          },
        },
        {
          new: true,
        }
      ).sort("numUses");
    }
  }
}
