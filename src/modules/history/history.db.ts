import { HydratedDocument } from "mongoose";
import { HistoryAction } from "../../loaders/enums";
import {
  AccountEntity,
  IAccountEntity,
} from "../account/entities/account.entity";
import { HistoryEntity, IHistoryEntity } from "./entities/history.entity";

export class HistoryDB {
  constructor() {}

  async isPostIdExisted(postId: string): Promise<boolean> {
    const history = await HistoryEntity.findOne({ postId: postId });
    if (history) {
      return true;
    }
    return false;
  }

  async add(history: {
    action: HistoryAction;
    postId: string;
    author: HydratedDocument<IAccountEntity>;
    targetSubreddit: string;
  }): Promise<void> {
    const newHistory = new HistoryEntity({
      action: history.action,
      postId: history.postId,
      author: history.author._id,
      targetSubreddit: history.targetSubreddit,
    });
    await newHistory.save();

    if (!history.author?.histories) {
      history.author.histories = [];
    }
    history.author.histories.push(newHistory._id);
  }
}
