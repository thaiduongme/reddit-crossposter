import { ProxyProvider } from "../../loaders/enums";
import { delay } from "../utils/other.utils";
import { ProxyEntity } from "./entities/proxy.entity";
import {
  Proxy,
  IProxyEntity,
  IRotatingProxy,
} from "./interfaces/proxy.interface";
import { HydratedDocument } from "mongoose";
import { Proxyno1RotatingProxy } from "./proxyno1.proxy";
import { ProxyType } from "aws-sdk/clients/migrationhubrefactorspaces";

export class ProxyDB {
  private currentProxyDB: HydratedDocument<IProxyEntity>;
  constructor(
    public readonly provider: ProxyProvider,
    public readonly type: ProxyType,
    public readonly maxUses: number = 2,
    public readonly retryTimeoutMs: number = 120000,
    public readonly retryPollingIntervalMs: number = 5000
  ) {}

  async startUsing(): Promise<Proxy> {
    const totalProxies = await ProxyEntity.countDocuments({
      provider: this.provider,
      type: this.type,
      status: true,
    });

    if (totalProxies == 0) {
      throw new Error(`[PROXY][ProxyDB][${this.provider}] Proxy list is empty`);
    }

    let rotatingProxy: IRotatingProxy;
    do {
      //  Find a proxy, with conditions:
      //  - numUses < maxUses
      //  - isRotating: false
      //  - status: true
      this.currentProxyDB = await ProxyEntity.findOneAndUpdate(
        {
          provider: this.provider,
          type: this.type,
          isRotating: false,
          numUses: { $lt: this.maxUses },
          status: true,
        },
        {
          $inc: { using: 1, numUses: 1 },
          lastUsed: new Date(),
        },
        { new: true }
      );
      if (this.currentProxyDB) {
        try {
          // Create a Rotating proxy and break the loop
          rotatingProxy = await this._createRotatingProxy();
          break;
        } catch (err) {
          // If an error occurred while creating
          // Return the state before getting it
          await ProxyEntity.updateOne(
            {
              _id: this.currentProxyDB._id,
            },
            {
              $inc: { using: -1, numUses: -1 },
            }
          );
          this.currentProxyDB = null;
          console.error(
            `[PROXY][ProxyDB][${this.provider}] An error occurred while creating a rotating proxy, ` +
              err
          );
        }
      }

      //  Find a proxy (to rotate), with conditions:
      //  - numUses >= maxUses
      //  - isRotating: false
      //  - using: 0
      //  - status: true
      let oldNumUses: number;
      this.currentProxyDB = await ProxyEntity.findOneAndUpdate(
        {
          provider: this.provider,
          type: this.type,
          isRotating: false,
          numUses: { $gte: this.maxUses },
          using: 0,
          status: true,
        },
        {
          isRotating: true,
          numUses: 0,
          using: 0,
          lastUsed: new Date(),
        },
        { new: false }
      );
      if (this.currentProxyDB) {
        try {
          oldNumUses = this.currentProxyDB.numUses;
          rotatingProxy = await this._createRotatingProxy();
          await rotatingProxy.changeIP();
          this.currentProxyDB = await ProxyEntity.findOneAndUpdate(
            {
              _id: this.currentProxyDB._id,
            },
            {
              isRotating: false,
              $inc: { using: 1, numUses: 1 },
              lastUsed: new Date(),
            },
            {
              new: true,
            }
          );
          break;
        } catch (err) {
          this.currentProxyDB = await ProxyEntity.findOneAndUpdate(
            {
              _id: this.currentProxyDB._id,
            },
            {
              isRotating: false,
              $inc: { using: 0, numUses: oldNumUses || 0 },
              lastUsed: new Date(),
            },
            {
              new: true,
            }
          );
          this.currentProxyDB = null;
          rotatingProxy = null;
          console.error(
            `[PROXY][ProxyDB][${this.currentProxyDB.apiKey}] Failed to change IP, ` +
              err
          );
        }
      }

      await delay(this.retryPollingIntervalMs);
    } while (!this.currentProxyDB);

    return await rotatingProxy.getInfo();
  }

  async endUsing(): Promise<void> {
    if (!this.currentProxyDB) {
      throw new Error(`[PROXY][ProxyDB] Must startUsing before endUsing`);
    }
    await ProxyEntity.updateOne(
      { apiKey: this.currentProxyDB.apiKey },
      {
        $inc: { using: -1 },
        lastUsed: new Date(),
      }
    );
    this.currentProxyDB = null;
  }

  private async _createRotatingProxy(): Promise<IRotatingProxy> {
    if (!this.currentProxyDB) {
      throw new Error(
        "[Proxy][ProxyDB] Failed to create Rotating Proxy, currentProxyDB doesn't exist"
      );
    }
    if (this.provider == ProxyProvider.ProxyNo1) {
      return await Proxyno1RotatingProxy.init(
        this.currentProxyDB.apiKey,
        this.retryTimeoutMs,
        this.retryPollingIntervalMs
      );
    }
  }
}
