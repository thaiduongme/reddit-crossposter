import proxy_check from "proxy-check";
import { Proxy } from "./interfaces/proxy.interface";

export class ProxyChecker {
  static async check(proxy: Proxy): Promise<boolean> {
    try {
      await proxy_check({
        host: proxy.host,
        port: proxy.port,
        proxyAuth: `${proxy?.username || ""}:${proxy.password || ""}`,
      });
      return true;
    } catch (err) {
      return false;
    }
  }
}
