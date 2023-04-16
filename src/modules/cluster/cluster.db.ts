import { HydratedDocument } from "mongoose";
import { BotType } from "../../loaders/enums";
import { ClusterEntity, IClusterEntity } from "./entities/cluster.entity";
import { getIp } from "../utils/other.utils";
import { LOG_PREFIX } from "../../loaders/constants";

export class ClusterDB {
  private cluster: HydratedDocument<IClusterEntity>;
  constructor() {}

  private async initialize() {
    console.log(`${LOG_PREFIX}[ClusterDB] Initializing`);
    const clusterId = +process.env.pm_id;
    console.log(`${LOG_PREFIX}[ClusterDB] ID: ${clusterId}`);
    const botType = BotType.CROSS_POSTER;
    console.log(`${LOG_PREFIX}[ClusterDB] Bot type: ${botType}`);
    const ip = await getIp();
    console.log(`${LOG_PREFIX}[ClusterDB] IP: ${ip}`);
    this.cluster = await ClusterEntity.findOne({
      clusterId,
      botType,
      ip,
    });
    if (!this.cluster) {
      this.cluster = new ClusterEntity();
      this.cluster.clusterId = clusterId;
      this.cluster.botType = botType;
      this.cluster.ip = ip;
      await this.cluster.save();
    }
    this.cluster.currentLog = "[ClusterDB] Initialized";
  }

  async updateLog(log: string) {
    // Cluster mode must be enabled
    if (!process?.env?.pm_id) {
      return;
    }

    // Case it's not initialized
    if (!this.cluster) {
      await this.initialize();
    }

    // Saving log
    this.cluster.currentLog = log;
    await this.cluster.save();
  }

  static async getNumRunningClusters(): Promise<number> {
    const MAX_UPDATED_LOG_MINS = 30;
    return await ClusterEntity.countDocuments({
      botType: BotType.KARMA_FARMER,
      updatedAt: {
        $gte: new Date(Date.now() - MAX_UPDATED_LOG_MINS * 60 * 1000),
      },
    });
  }
}
