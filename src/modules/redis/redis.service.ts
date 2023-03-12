import Redis from "ioredis";
import Redlock from "redlock";

export class RedisService {
  private constructor(
    public readonly redis: Redis,
    public readonly redlock: Redlock
  ) {}

  static async init(host: string, port: number): Promise<RedisService> {
    const redis = new Redis({
      host,
      port,
    });
    const redlock = new Redlock([redis], {
      driftFactor: 0.01,
      retryCount: 100,
      retryDelay: 2000,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    });
    return new RedisService(redis, redlock);
  }

  async get(key: string) {
    const value = JSON.parse(await this.redis.get(key));
    if (!value) return null;
    return value;
  }

  async set(key: string, value: any) {
    await this.redis.set(key, JSON.stringify(value));
    return value;
  }

  async setWithExpiration(key: string, value: any, expiration: number) {
    await this.redis.set(key, JSON.stringify(value), "EX", expiration);
    return value;
  }
}
