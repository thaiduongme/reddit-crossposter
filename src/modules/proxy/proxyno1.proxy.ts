import { IRotatingProxy, Proxy } from "./interfaces/proxy.interface";
import { ProxyChecker } from "./proxy-checker";
import delay from "delay";
import axios from "axios";
import HttpsProxyAgent from "https-proxy-agent/dist/agent";
import cluster from "node:cluster";

export class Proxyno1RotatingProxy implements IRotatingProxy {
  constructor(
    public readonly apiKey: string,
    public readonly host: string,
    public readonly port: number,
    public readonly username: string,
    public readonly password: string,
    public readonly retryTimeoutMs: number,
    public readonly retryPollingIntervalMs: number
  ) {}

  public static async init(
    apiKey: string,
    retryTimeoutMs: number = 120000,
    retryPollingIntervalMs: number = 5000
  ): Promise<Proxyno1RotatingProxy> {
    const apiKeyStatus = await axios.get(
      `https://app.proxyno1.com/api/key-status/${apiKey}`
    );

    if (apiKeyStatus.data.status != 0) {
      throw new Error(
        `[PROXY][Proxyno1][${apiKey}] Can't get proxy info, ${apiKeyStatus.data.message}`
      );
    }
    return new Proxyno1RotatingProxy(
      apiKey,
      apiKeyStatus.data.data.proxy.ip,
      apiKeyStatus.data.data.proxy.HTTP_IPv4,
      apiKeyStatus.data.data.authentication.split(":")[0],
      apiKeyStatus.data.data.authentication.split(":")[1],
      retryTimeoutMs,
      retryPollingIntervalMs
    );
  }

  async getInfo(): Promise<Proxy> {
    try {
      const ipResponse = await (
        await axios.get(`https://api.ipify.org/?format=json`, {
          httpsAgent: new HttpsProxyAgent({
            host: this.host,
            port: this.port,
            auth: `${this.username}:${this.password}`,
          }),
        })
      ).data;
      console.log(
        `[Cluster ${process.env.pm_id}][PROXY][ProxyNo1] Current IP: ${ipResponse.ip}`
      );
    } catch {}

    return {
      host: this.host,
      port: this.port,
      username: this.username,
      password: this.password,
    };
  }

  async changeIP(): Promise<void> {
    console.log(`[Cluster ${process.env.pm_id}][PROXY][Proxyno1] Changing IP`);
    let changeIPResponse: any;

    const startTime = Date.now();
    do {
      changeIPResponse = (
        await axios.get(
          `https://app.proxyno1.com/api/change-key-ip/${this.apiKey}`
        )
      ).data;

      const waitingPattern = /\s(\d+)\s/g;
      const waitingResult = changeIPResponse.message.match(waitingPattern);
      if (waitingResult) {
        console.log(
          `[Cluster ${process.env.pm_id}][PROXY][Proxyno1][${
            this.apiKey
          }] Waiting ${parseInt(waitingResult[0])}(s) to change IP`
        );
        await delay(parseInt(waitingResult[0]) * 1000);
        await delay(5000);
        continue;
      } else {
        await delay(5000);
      }

      const proxyPollingIntervalMs = 200;
      const proxyCheckerTimeoutMs = 120000;
      if (changeIPResponse.status == 0) {
        const startTime = Date.now();
        while (true) {
          if (
            await ProxyChecker.check({
              host: this.host,
              port: this.port,
              username: this.username,
              password: this.password,
            })
          ) {
            return;
          }
          const now = Date.now();
          if (now - startTime >= proxyCheckerTimeoutMs) {
            throw new Error(
              `[PROXY][Proxyno1][${this.apiKey}] Proxy Checker timed out, exceeded ${proxyCheckerTimeoutMs}ms`
            );
          }
          await delay(proxyPollingIntervalMs);
        }
      }

      const now = Date.now();
      if (now - startTime >= this.retryTimeoutMs) {
        throw new Error(
          `[PROXY][Proxyno1][${this.apiKey}] Can't change IP, timed out`
        );
      }
      await delay(this.retryPollingIntervalMs);
    } while (true);
  }
}
