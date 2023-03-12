import puppeteer from "puppeteer-extra";
import { IBrowserOptions } from "./interfaces/browser-options.interface";
import { IBrowser } from "./interfaces/browser.interface";
import GoLogin from "./gologin/gologin";
import { CaptchaSolvingProvider, GologinOS } from "../../loaders/enums";
import { Browser, Page } from "puppeteer";
import axios from "axios";
import os from "os";
import * as AWS from "aws-sdk";
import { config } from "../../config/configuration";
import { BROWSER_EXTRA_PARAMS } from "../../loaders/constants";
import * as path from "node:path";
import delay from "delay";
import { randomString } from "../utils/other.utils";
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { Proxy } from "../proxy/interfaces/proxy.interface";
import cluster from "node:cluster";

export class GologinBrowser implements IBrowser {
  private isLoadedCaptchaSolver: boolean;
  private constructor(
    private readonly gologin: GoLogin,
    private readonly browser: Browser,
    private profileId: string,
    public options: IBrowserOptions
  ) {}

  static async initialize(options: IBrowserOptions): Promise<GologinBrowser> {
    if (
      options.captchaSolver &&
      options.captchaSolver.provider === CaptchaSolvingProvider.NopeCHA
    ) {
      console.log(
        `[Cluster ${process.env.pm_id}][GOLOGIN][Browser] Validating NopeCHA API key`
      );
      await this.validateNopechaApiKey(options.captchaSolver.apiKey);
      const nopechaPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "third-party",
        "nopecha-chrome-extension"
      );
      BROWSER_EXTRA_PARAMS.push(`--load-extension=${nopechaPath}`);
    }

    const gologinOptions: any = {
      token: options.accessToken,
      extra_params: BROWSER_EXTRA_PARAMS,
      skipOrbitaHashChecking: true,
      autoUpdateBrowser: true,
    };

    if (options.extra_params)
      gologinOptions.extra_params = gologinOptions.extra_params.concat(
        options.extra_params
      );

    const profileOptions: {
      os: string;
      proxy?: {
        mode: string;
        host: string;
        port: number;
        username?: string;
        password?: string;
      };
    } = {
      os: GologinOS.WINDOWS,
      proxy: {
        mode: "none",
        port: 80,
        host: "",
        username: "",
        password: "",
      },
    };

    if (options.proxy) {
      const proxy = options.proxy;
      profileOptions.proxy = {
        mode: "http",
        host: proxy.host,
        port: proxy.port,
      };
      if (proxy?.username && proxy?.password) {
        profileOptions.proxy.username = proxy.username;
        profileOptions.proxy.password = proxy.password;
      }
    }

    const gologin = new GoLogin(gologinOptions);

    if (options.profileId) {
      if (await this.isProfileExisted(options.profileId)) {
        await gologin.update({
          id: options.profileId,
          proxy: profileOptions.proxy,
        });
      } else {
        options.profileId = null;
      }
    }

    // Create a new Gologin profile
    if (!options.profileId) {
      const profileId = await gologin.create(profileOptions);
      await gologin.update({
        id: profileId,
      });
    }

    const { wsUrl } = await gologin.start();
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl.toString(),
      ignoreHTTPSErrors: true,
    });

    return new GologinBrowser(gologin, browser, gologin.profile_id, options);
  }

  async getPage(): Promise<Page> {
    this.browser.on("targetcreated", async (target) => {
      const page = await target.page();
      if (page) {
        const viewPort = this.gologin.getViewPort() as any;
        await page.setViewport({
          width: Math.round(viewPort.width * 0.994),
          height: Math.round(viewPort.height * 0.92),
          isLandscape: true,
        });
        const session = await page.target().createCDPSession();
        const { windowId } = await session.send("Browser.getWindowForTarget");
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: viewPort,
        });
        await session.send("Page.enable");
        await session.send("Page.setWebLifecycleState", { state: "active" });
        await session.detach();
        page.setDefaultNavigationTimeout(config.browser.defaultTimeoutMs);
        page.setDefaultTimeout(config.browser.defaultTimeoutMs);
      }
    });
    const page = await this.browser.newPage();

    if (
      this.options.captchaSolver &&
      this.options.captchaSolver.provider == CaptchaSolvingProvider.NopeCHA &&
      !this.isLoadedCaptchaSolver
    ) {
      // Setting the Nopecha extension
      for (let i = 0; i < 5; i++) {
        try {
          await page.goto(
            `https://nopecha.com/setup#${this.options.captchaSolver.apiKey}`,
            {
              waitUntil: "networkidle0",
              timeout: 10000,
            }
          );
        } catch {}

        await delay(500);
      }
      this.isLoadedCaptchaSolver = true;
    }
    return page;
  }

  async close(): Promise<void> {
    await this.browser.close();
    await this.gologin.stopBrowser();
    await this.gologin.stop();
  }

  static async validateGologinAPIKey(apiKey: string): Promise<boolean> {
    try {
      const userResponseData = (
        await axios.get("https://api.gologin.com/user", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        })
      ).data;
      if (
        !userResponseData.planExpireDate ||
        new Date(userResponseData.planExpireDate) < new Date()
      ) {
        return false;
        // throw new Error(
        //   `[GOLOGIN][Validate API Key] API Key is already expired.`
        // );
      }

      if (userResponseData.profiles == userResponseData.plan.maxProfiles) {
        return false;
        // throw new Error(
        //   `[GOLOGIN][Validate API Key] Maximum profile number exceeded.`
        // );
      }
    } catch (err) {
      return false;
      // throw new Error(`[GOLOGIN][Validate API Key] API Key is invalid.`);
    }
    return true;
  }

  static async validateNopechaApiKey(apiKey: string): Promise<void> {
    const startTime = Date.now();
    const timeoutMs = 60000;
    const pollingIntervalMs = 3000;
    while (true) {
      try {
        const response = await axios.get(
          `https://api.nopecha.com/status/?key=${apiKey}`
        );
        if (response.data?.error) {
          throw new Error(
            `[NopeCHA][Validate API Key][${apiKey}] ${response.data?.message}`
          );
        }
        if (response.data?.credit && response.data.credit == 0) {
          throw new Error(
            `[NopeCHA][Validate API Key][${apiKey}] Credit exceeded for a day ${response.data.credit}/${response.data.quota}`
          );
        }
        return;
      } catch (err) {
        err = err;
      }
      const now = Date.now();
      if (now - startTime >= timeoutMs) {
        throw new Error(`[NopeCHA][Validate API Key][${apiKey}] Timed out`);
      }
      await delay(pollingIntervalMs);
    }
  }

  static async getNewAPIKey(proxy?: Proxy): Promise<string> {
    const startTime = Date.now();
    const timeoutMs = 60000;
    const pollingIntervalMs = 5000;
    while (true) {
      try {
        const password = randomString(8);
        const signupResponseData = (
          await axios.post(
            "https://api.gologin.com/user?free-plan=true",
            {
              email: `${randomString(10)}@gmail.com`,
              password: password,
              passwordConfirm: password,
              googleClientId: "2104414661.1673774926",
              filenameParserError: "",
              fromApp: false,
              fromAppTrue: false,
              canvasAndFontsHash: "17ddc821217941e4",
              affiliate: "",
              fontsHash: "aacb32b9ec6db007",
              canvasHash: "875325766",
            },
            {
              httpsAgent: proxy
                ? {
                    httpsAgent: new HttpsProxyAgent({
                      host: proxy.host,
                      port: proxy.port,
                      auth: `${proxy.username}:${proxy.password}`,
                    }),
                  }
                : new https.Agent({ keepAlive: true }),
              headers: {
                authority: "api.gologin.com",
                accept: "*/*",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/json",
                origin: "https://app.gologin.com",
                referer: "https://app.gologin.com/",
                "sec-ch-ua": `"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"`,
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": `"Windows"`,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
              },
            }
          )
        ).data;
        const bearerToken = signupResponseData.token;

        const devTokenResponseData = (
          await axios.post(
            "https://api.gologin.com/user/dev",
            { name: "hidden-boat" },
            {
              httpsAgent: proxy
                ? {
                    httpsAgent: new HttpsProxyAgent({
                      host: proxy.host,
                      port: proxy.port,
                      auth: `${proxy.username}:${proxy.password}`,
                    }),
                  }
                : new https.Agent({ keepAlive: true }),
              headers: {
                authority: "api.gologin.com",
                accept: "*/*",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/json",
                origin: "https://app.gologin.com",
                referer: "https://app.gologin.com/",
                "sec-ch-ua": `"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"`,
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": `"Windows"`,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
                authorization: `Bearer ${bearerToken}`,
              },
            }
          )
        ).data;

        return devTokenResponseData.dev_token;
      } catch (err) {
        console.error(`[GOLOGIN][Get new API Key] ${err}`);
      }
      const now = Date.now();
      if (now - startTime >= timeoutMs) {
        throw new Error("[GOLOGIN][Get new API Key] Timed out");
      }
      await delay(pollingIntervalMs);
    }
  }

  getProfileId(): string {
    return this.profileId;
  }

  getBrowser(): Browser {
    return this.browser;
  }

  static async isProfileExisted(profileId: string): Promise<boolean> {
    const s3 = new AWS.S3({
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretKey,
    });

    const profileFolderParams = {
      Bucket: config.aws.s3BucketName,
      Key: `${profileId}.zip`,
    };
    const profileJSONParams = {
      Bucket: config.aws.s3BucketName,
      Key: `${profileId}.json`,
    };
    try {
      await s3.getObject(profileFolderParams).promise();
      await s3.getObject(profileJSONParams).promise();
      return true;
    } catch {
      return false;
    }
  }
}
