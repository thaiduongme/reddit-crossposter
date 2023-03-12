import { config, validateEnvironmentVars } from "./config/configuration";
import { GologinBrowser } from "./modules/browser/gologin.browser";
import { MongodbHelper } from "./database/mongodb.db";
import { RedisService } from "./modules/redis/redis.service";
import { ProxyProvider, ProxyType } from "./loaders/enums";
import { ProxyDB } from "./modules/proxy/proxy.db";
import { REDIS_GOLOGIN_API_KEY } from "./loaders/constants";
import { Proxy } from "./modules/proxy/interfaces/proxy.interface";
import { RedditCrossposterBot } from "./modules/bot/reddit.bot";
import { IAccountEntity } from "./modules/account/entities/account.entity";
import { HydratedDocument } from "mongoose";
import { ChatGPTClient } from "./modules/chatgpt/chatgpt";
import delay from "delay";
import { SubredditDB } from "./modules/subreddit/subreddit.db";
import perf from "execution-time";
import { HistoryDB } from "./modules/history/history.db";
import { PostDB } from "./modules/post/post.db";
import { ImgurUploader } from "./modules/uploader/imgur.uploader";
import { IAccountDB } from "./modules/account/interfaces/account-db.interface";
import { CrosspostAccountDB } from "./modules/account/crosspost-account.db";

async function main() {
  console.log(`[Cluster ${process.env.pm_id}][ENV VARS] Validating`);
  validateEnvironmentVars();

  console.log(`[Cluster ${process.env.pm_id}][DATABASE][MongoDB] Connecting`);
  const mongodbHelper = new MongodbHelper(
    config.mongodb.host,
    config.mongodb.database,
    config.mongodb.username,
    config.mongodb.password
  );
  await mongodbHelper.connect();

  console.log(`[Cluster ${process.env.pm_id}][CACHE][Redis] Connecting`);
  const redisService = await RedisService.init(
    config.redis.host,
    config.redis.port
  );

  console.log(`[Cluster ${process.env.pm_id}][PROXY][ProxyDB] Initializing`);
  const proxyDB = new ProxyDB(
    ProxyProvider.ProxyNo1,
    ProxyType.RESIDENTIAL,
    config.proxy.maxUses,
    config.proxy.retryTimeoutMs,
    config.proxy.retryPollingIntervalMs
  );

  console.log(
    `[Cluster ${process.env.pm_id}][CACHE][Redis] Loading Gologin API key`
  );
  let gologinApiKey = await redisService.get(REDIS_GOLOGIN_API_KEY);
  if (!gologinApiKey) {
    gologinApiKey = await redisService.set(
      REDIS_GOLOGIN_API_KEY,
      await GologinBrowser.getNewAPIKey()
    );
  }

  console.log(
    `[Cluster ${process.env.pm_id}][CrosspostAccountDB] Initializing`
  );
  const accountDB: IAccountDB = new CrosspostAccountDB(
    config.redditCrossposter.minimumDaysOld,
    config.redditCrossposter.minimumKarma,
    config.redditCrossposter.frequency
  );

  console.log(`[Cluster ${process.env.pm_id}][SubredditDB] Initializing`);
  const subredditDB = new SubredditDB();

  console.log(`[Cluster ${process.env.pm_id}][HistoryDB] Initializing`);
  const historyDB = new HistoryDB();

  console.log(`[Cluster ${process.env.pm_id}][PostDB] Initializing`);
  const postDB = new PostDB();

  console.log(`[Cluster ${process.env.pm_id}][ChatGPT] Initializing`);
  const chatGptClient = new ChatGPTClient(
    config.chatgpt.baseApiUrl,
    config.chatgpt.apiSecretKey
  );

  while (true) {
    // Used for calculating execution time
    const performance = perf();
    performance.start();

    let gologinBrowser: GologinBrowser;
    let proxy: Proxy;
    let account: HydratedDocument<IAccountEntity>;
    let isCrossposted = false;
    try {
      console.log(`[Cluster ${process.env.pm_id}][GOLOGIN] Validating API key`);
      if (!(await GologinBrowser.validateGologinAPIKey(gologinApiKey))) {
        console.log(
          `[Cluster ${process.env.pm_id}][GOLOGIN] Invalid API key, getting a new one`
        );
        await redisService.set(
          REDIS_GOLOGIN_API_KEY,
          await GologinBrowser.getNewAPIKey()
        );
        gologinApiKey = await redisService.get(REDIS_GOLOGIN_API_KEY);
      }

      console.log(
        `[Cluster ${process.env.pm_id}][CrosspostAccountDB] Getting an account`
      );
      while (!account) {
        account = await accountDB.startUsing();
        if (!account) {
          console.log(
            `[Cluster ${
              process.env.pm_id
            }][AccountDB] No accounts are ready, sleeping for ${Math.floor(
              config.redditCrossposter.sleepMs / 1000 / 60
            )} minutes...`
          );
          await delay(config.redditCrossposter.sleepMs);
        }
      }

      console.log(
        `[Cluster ${process.env.pm_id}][PROXY][ProxyDB] Getting a proxy`
      );
      proxy = await proxyDB.startUsing();

      console.log(
        `[Cluster ${process.env.pm_id}][Uploader][Imgur] Initializing`
      );
      const imgurUploader = new ImgurUploader(config.imgur.clientId, proxy);

      // Initialize Browser
      console.log(`[Cluster ${process.env.pm_id}][GOLOGIN] Initializing`);
      gologinBrowser = await GologinBrowser.initialize({
        accessToken: gologinApiKey,
        proxy,
        profileId: account.profileId,
      });

      console.log(`[Cluster ${process.env.pm_id}][GOLOGIN][Page] Initializing`);
      const page = await gologinBrowser.getPage();

      console.log(`[Cluster ${process.env.pm_id}][BOT] Initializing`);
      const redditCrossposterBot = await RedditCrossposterBot.initialize({
        page: page,
        browser: gologinBrowser,
        account: account,
        chatGptClient: chatGptClient,
        captchaTimeoutMs: config.captcha.timeoutMs,
        captchaPollingIntervalMs: config.captcha.pollingIntervalMs,
        historyDB: historyDB,
        postDB: postDB,
        subredditDB: subredditDB,
        uploader: imgurUploader,
      });

      await redditCrossposterBot.start();
      isCrossposted = true;
    } catch (err) {
      console.error(err);
    } finally {
      if (proxy) {
        await proxyDB.endUsing();
        console.log(
          `[Cluster ${process.env.pm_id}][PROXY][ProxyDB] Ended using`
        );
      }
      if (gologinBrowser && account) {
        account.profileId = gologinBrowser.getProfileId();
        await account.save();
      }
      if (account) {
        await accountDB.endUsing(isCrossposted);
        console.log(`[Cluster ${process.env.pm_id}][AccountDB] Ended using`);
      }
      if (gologinBrowser) {
        await gologinBrowser.close();
        console.log(`[Cluster ${process.env.pm_id}][GOLOGIN] Closed browser`);
      }
    }
    const executionTime = performance.stop();
    console.log(
      `[Cluster ${process.env.pm_id}][${account?.username}] Finished in ${executionTime.preciseWords}`
    );
  }
}

main().catch((err) => {
  if (err) {
    console.error(`[Cluster ${process.env.pm_id}] ` + err);
    process.exit();
  }
});
