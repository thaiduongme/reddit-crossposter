import { HydratedDocument } from "mongoose";
import { FarmStage } from "../../loaders/enums";
import { AccountEntity, IAccountEntity } from "./entities/account.entity";
import {
  FrequencyByStage,
  IAccountDB,
} from "./interfaces/account-db.interface";
import { ClusterDB } from "../cluster/cluster.db";
import { logInfo } from "../utils/other.utils";

export class CrosspostAccountDB implements IAccountDB {
  private currentAccount: HydratedDocument<IAccountEntity>;
  constructor(
    private readonly minimumDaysOld: number,
    private readonly minimumKarma: number,
    private readonly frequency: FrequencyByStage[],
    private readonly numAccountsPerCluster: number
  ) {}

  async startUsing(): Promise<HydratedDocument<IAccountEntity>> {
    // Getting all accounts sorted by createdDate
    // Limiting them by numberOfRunningCluster * numAccountsPerCluster
    const NUM_RUNNING_CLUSTERS = (await ClusterDB.getNumRunningClusters()) || 1;

    const accounts = await AccountEntity.aggregate([
      // Find accounts that:
      // - status: true
      // - createdDate: minimum 5 days ago
      {
        $match: {
          status: true,
          createdDate: {
            $lte: new Date(
              Date.now() - this.minimumDaysOld * 24 * 60 * 60 * 1000
            ),
          },
        },
      },
      // Sort by createdDate ascending
      // This will help us to get the same set with a decent number of clusters
      { $sort: { createdDate: 1 } },
      // Limit by NUM_RUNNING_CLUSTERS * MAX_ACCOUNTS_PER_DAY
      { $limit: NUM_RUNNING_CLUSTERS * this.numAccountsPerCluster },
      // Sort by nextCrosspost descending
      { $sort: { nextCrosspost: -1 } },
    ]).exec();

    await logInfo(`[AccountDB] Total: ${accounts.length} (accounts)`);

    for (const account of accounts) {
      this.currentAccount = await AccountEntity.findOneAndUpdate(
        {
          _id: account._id,
          farmStage: {
            $in: this.frequency.map(
              (frequencyByStage) => frequencyByStage.stage
            ),
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
                {
                  nextCrosspost: { $exists: false },
                },
                {
                  nextCrosspost: { $lte: new Date() },
                },
              ],
            },
          ],
        },
        {
          using: true,
          lastUsed: new Date(),
        },
        {
          new: true,
        }
      );
      if (this.currentAccount) break;
    }

    if (!this.currentAccount) {
      return null;
    }

    return this.currentAccount;
  }

  async endUsing(status: boolean): Promise<void> {
    if (!this.currentAccount) {
      throw new Error(`[AccountDB] Must start using before end using`);
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
