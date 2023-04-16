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
import { logError, logInfo } from "./modules/utils/other.utils";

async function main() {
  await logInfo(`[ENV VARS] Validating`);
  validateEnvironmentVars();

  await logInfo(`[DATABASE][MongoDB] Connecting`);
  const mongodbHelper = new MongodbHelper(
    config.mongodb.host,
    config.mongodb.database,
    config.mongodb.username,
    config.mongodb.password
  );
  await mongodbHelper.connect();

  await logInfo(`[Redis] Connecting`);
  const redisService = await RedisService.init(
    config.redis.host,
    config.redis.port
  );

  await logInfo(`[ProxyDB] Initializing`);
  const proxyDB = new ProxyDB(
    ProxyProvider.ProxyNo1,
    ProxyType.RESIDENTIAL,
    config.proxy.maxUses,
    config.proxy.retryTimeoutMs,
    config.proxy.retryPollingIntervalMs
  );

  await logInfo(`[Redis] Loading GoLogin API key`);
  let gologinApiKey = await redisService.get(REDIS_GOLOGIN_API_KEY);
  if (!gologinApiKey) {
    await logInfo(`[Redis] GoLogin API key was not found, creating a new one`);
    gologinApiKey = await redisService.set(
      REDIS_GOLOGIN_API_KEY,
      await GologinBrowser.getNewAPIKey()
    );
  }

  await logInfo(`[CrosspostAccountDB] Initializing`);
  const accountDB: IAccountDB = new CrosspostAccountDB(
    config.redditCrossposter.minimumDaysOld,
    config.redditCrossposter.minimumKarma,
    config.redditCrossposter.frequency,
    config.reddit.numAccountsPerCluster
  );

  await logInfo(`[SubredditDB] Initializing`);
  const subredditDB = new SubredditDB();

  await logInfo(`[HistoryDB] Initializing`);
  const historyDB = new HistoryDB();

  await logInfo(`[PostDB] Initializing`);
  const postDB = new PostDB();

  await logInfo(`[ChatGPT] Initializing`);
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
      await logInfo(`[GoLogin] Validating API key`);
      if (!(await GologinBrowser.validateGologinAPIKey(gologinApiKey))) {
        await logInfo(`[GoLogin] Invalid API key, getting a new one`);
        await redisService.set(
          REDIS_GOLOGIN_API_KEY,
          await GologinBrowser.getNewAPIKey()
        );
        gologinApiKey = await redisService.get(REDIS_GOLOGIN_API_KEY);
      }

      await logInfo(`[AccountDB] Getting an account`);
      while (!account) {
        account = await accountDB.startUsing();
        if (!account) {
          await logInfo(
            `[AccountDB] No accounts are ready, sleeping for ${Math.floor(
              config.redditCrossposter.sleepMs / 1000 / 60
            )} minutes...`
          );
          await delay(config.redditCrossposter.sleepMs);
        }
      }
      await logInfo(`[AccountDB] Using account: ${account.username}`);

      await logInfo(`[ProxyDB] Getting a proxy`);
      proxy = await proxyDB.startUsing();

      await logInfo(`[Imgur] Initializing`);
      const imgurUploader = new ImgurUploader(config.imgur.clientId, proxy);

      // Initialize Browser
      await logInfo(`[GoLogin] Initializing browser`);
      gologinBrowser = await GologinBrowser.initialize({
        accessToken: gologinApiKey,
        proxy,
        profileId: account.profileId,
      });

      await logInfo(`[GoLogin] Initializing page`);
      const page = await gologinBrowser.getPage();

      await logInfo(`[Bot] Initializing`);
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

      await logInfo(`[Bot] Starting`);
      // await redditCrossposterBot.start();
      await redditCrossposterBot.crosspost();
      isCrossposted = true;
    } catch (err) {
      await logError(err as string);
      console.error(err);
    } finally {
      if (proxy) {
        await logInfo(`[ProxyDB] Ending using`);
        await proxyDB.endUsing();
      }
      if (gologinBrowser && account) {
        await logInfo(`[AccountDB] Saving profileId`);
        account.profileId = gologinBrowser.getProfileId();
        await account.save();
      }
      if (account) {
        await logInfo(`[AccountDB] Ending using`);
        await accountDB.endUsing(isCrossposted);
      }
      if (gologinBrowser) {
        await logInfo(`[GOLOGIN] Closing browser`);
        await gologinBrowser.close();
      }
    }
    const executionTime = performance.stop();
    await logInfo(`Finished in ${executionTime.preciseWords}`);
  }
}

main().catch(async (err) => {
  if (err) {
    await logError(` ` + err);
    process.exit();
  }
});
