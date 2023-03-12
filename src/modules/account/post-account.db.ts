import { HydratedDocument } from "mongoose";
import { FarmStage } from "../../loaders/enums";
import { AccountEntity, IAccountEntity } from "./entities/account.entity";
import { IAccountDB } from "./interfaces/account-db.interface";

export class PostAccountDB implements IAccountDB {
  private currentAccount: HydratedDocument<IAccountEntity>;
  constructor(
    private readonly minimumDaysOld: number,
    private readonly minimumKarma: number,
    private readonly farmStages: FarmStage[],
    private readonly numDailyPostsPerAccount: number
  ) {}

  async startUsing(): Promise<HydratedDocument<IAccountEntity>> {
    // const now = new Date();
    // const account = await AccountEntity.findOneAndUpdate(
    //   {
    //     status: true,
    //     createdDate: {
    //       $lte: now.setDate(now.getDate() - this.minimumDaysOld),
    //     },
    //     totalKarma: {
    //       $gte: this.minimumKarma,
    //     },
    //     $and: [
    //       {
    //         $or: [
    //           {
    //             using: { $exists: false },
    //           },
    //           { using: false },
    //         ],
    //       },
    //       {
    //         $or: [
    //           { nextPost: { $exists: false } },
    //           {
    //             nextPost: { $lte: new Date() },
    //           },
    //         ],
    //       },
    //     ],
    //     farmStage: {
    //       $in: this.farmStages,
    //     },
    //   },
    //   {
    //     using: true,
    //     lastUsed: new Date(),
    //   },
    //   { new: true }
    // ).sort({ lastUsed: 1 });

    const account = await AccountEntity.findOne({ username: "norma_2764" });
    this.currentAccount = account;
    return this.currentAccount;
  }

  async endUsing(): Promise<void> {
    if (!this.currentAccount) {
      throw new Error(`[PostAccountDB] Must start using before end using`);
    }
    const nextPost = new Date();
    nextPost.setHours(
      nextPost.getHours() + Math.floor(24 / this.numDailyPostsPerAccount)
    );
    await AccountEntity.updateOne(
      { _id: this.currentAccount._id },
      { using: false, lastUsed: new Date(), nextPost: nextPost }
    );

    this.currentAccount = null;
  }
}
