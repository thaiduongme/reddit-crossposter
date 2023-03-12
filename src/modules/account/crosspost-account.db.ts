import { HydratedDocument } from "mongoose";
import { FarmStage } from "../../loaders/enums";
import { AccountEntity, IAccountEntity } from "./entities/account.entity";
import {
  FrequencyByStage,
  IAccountDB,
} from "./interfaces/account-db.interface";

export class CrosspostAccountDB implements IAccountDB {
  private currentAccount: HydratedDocument<IAccountEntity>;
  constructor(
    private readonly minimumDaysOld: number,
    private readonly minimumKarma: number,
    private readonly frequency: FrequencyByStage[]
  ) {}

  async startUsing(): Promise<HydratedDocument<IAccountEntity>> {
    const now = new Date();
    const account = await AccountEntity.findOneAndUpdate(
      {
        status: true,
        createdDate: {
          $lte: now.setDate(now.getDate() - this.minimumDaysOld),
        },
        totalKarma: {
          $gte: this.minimumKarma,
        },
        $and: [
          {
            $or: [
              {
                using: { $exists: false },
              },
              { using: false },
            ],
          },
          {
            $or: [
              { nextCrosspost: { $exists: false } },
              {
                nextCrosspost: { $lte: new Date() },
              },
            ],
          },
        ],
        farmStage: {
          $in: this.frequency.map((frequencyByStage) => frequencyByStage.stage),
        },
      },
      {
        using: true,
        lastUsed: new Date(),
      },
      { new: true }
    ).sort({ lastUsed: 1 });

    this.currentAccount = account;
    return this.currentAccount;
  }

  async endUsing(status: boolean): Promise<void> {
    if (!this.currentAccount) {
      throw new Error(`[PostAccountDB] Must start using before end using`);
    }
    const nextCrosspost = new Date();
    if (status) {
      nextCrosspost.setHours(
        nextCrosspost.getHours() +
          Math.floor(
            24 /
              this.frequency.find(
                (frequencyByStage) =>
                  frequencyByStage.stage == this.currentAccount.farmStage
              ).frequency
          )
      );
    }

    await AccountEntity.updateOne(
      { _id: this.currentAccount._id },
      { using: false, lastUsed: new Date(), nextCrosspost: nextCrosspost }
    );

    this.currentAccount = null;
  }
}
