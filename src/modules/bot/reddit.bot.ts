import { Page, KeyInput, HTTPResponse, ElementHandle } from "puppeteer";
import {
  GhostCursor,
  createCursor,
  getRandomPagePoint,
  installMouseHelper,
} from "ghost-cursor";
import delay from "delay";
import {
  randint,
  choice,
  isValidateLink,
  findAsync,
} from "../utils/other.utils";
import { HydratedDocument } from "mongoose";
import { IAccountEntity } from "../account/entities/account.entity";
import { IBrowser } from "../browser/interfaces/browser.interface";
import _, { join } from "lodash";
import { ChatGPTClient } from "../chatgpt/chatgpt";
import { BotAction, HistoryAction } from "../../loaders/enums";
import { SubredditDB } from "../subreddit/subreddit.db";
import { ISubredditEntity } from "../subreddit/entities/subreddit.entity";
import { HistoryDB } from "../history/history.db";
import { PostDB } from "../post/post.db";
import { IUploader } from "../uploader/interfaces/uploader.interface";
import { IPostEntity } from "../post/entities/post.entity";
import { request } from "undici";

export class RedditCrossposterBot {
  private loginResult: {
    status: boolean;
    message?: string;
  };
  private constructor(
    private page: Page,
    private readonly browser: IBrowser,
    private cursor: GhostCursor,
    private readonly account: HydratedDocument<IAccountEntity>,
    private chatGptClient: ChatGPTClient,
    private captchaTimeoutMs: number,
    private captchaPollingIntervalMs: number,
    private historyDB: HistoryDB,
    private postDB: PostDB,
    private subredditDB: SubredditDB,
    private uploader: IUploader
  ) {}

  static async initialize(opts: {
    page: Page;
    browser: IBrowser;
    account: HydratedDocument<IAccountEntity>;
    chatGptClient: ChatGPTClient;
    captchaTimeoutMs?: number;
    captchaPollingIntervalMs?: number;
    historyDB: HistoryDB;
    postDB: PostDB;
    subredditDB: SubredditDB;
    uploader: IUploader;
  }): Promise<RedditCrossposterBot> {
    const {
      page,
      browser,
      account,
      chatGptClient,
      captchaTimeoutMs = 60000,
      captchaPollingIntervalMs = 200,
      historyDB,
      postDB,
      subredditDB,
      uploader,
    } = opts;

    // Initialize cursor
    const cursor = createCursor(page, await getRandomPagePoint(page));
    await installMouseHelper(page);

    // Bypass annoying Reddit pop-up allow notification
    let sessionId: string;
    let userId = await this.getIdFromUsername(account.username);
    try {
      const cookieObj = JSON.parse(account?.cookie);
      const sessionTrackerCookie = cookieObj.find(
        (cookie) => cookie.name == "session_tracker"
      );
      sessionId = sessionTrackerCookie?.value?.split(".")?.[0];
    } catch {}
    sessionId = sessionId || "bypassed";
    await page.evaluateOnNewDocument(
      (sessionId, userId) => {
        window.localStorage.setItem("desktop-notifications", "0");
        window.localStorage.setItem("ui.shown.welcome", "true");
        window.localStorage.setItem("should-show-comment-tab-tooltip", "false");
        window.localStorage.setItem("email-collection-reprompt-store", "-1");
        window.localStorage.setItem("ecb.showControlCount", "2");
        window.localStorage.setItem("evb.showControlCount", "2");
        window.localStorage.setItem("ecb.closingControlTime", `${Date.now()}`);
        window.localStorage.setItem("evb.closingControlTime", `${Date.now()}`);
        window.localStorage.setItem(
          "feature-throttling-store",
          JSON.stringify({
            feature_gate: [{ sessionId, when: Date.now() }],
            triggered: [{ sessionId, when: Date.now() }],
            dismissed: [{ sessionId, when: Date.now() }],
          })
        );
        window.localStorage.setItem(
          "email.verification_prompt",
          JSON.stringify({
            expires: Date.now() + 10 ** 11,
            value: { ["t2_" + userId]: -8 },
          })
        );
      },
      sessionId,
      userId
    );

    // Hide all tooltips & toasters
    await page.evaluateOnNewDocument(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.type = "text/css";
        style.innerHTML = `div[id*="infotooltip" i][id*="hover" i], div[data-testid="toaster" i] {
          display: none !important;
        }`;
        document.head.appendChild(style);
      });
    });

    // Granting notification permission
    // const context = (await browser.getBrowser()).defaultBrowserContext();
    // await context.overridePermissions("https://reddit.com", ["notifications"]);

    // Leave site dialog -> Yes
    page.on("dialog", (dialog) => {
      // dialog.type() == "beforeunload" && dialog.accept();
      dialog.accept();
    });

    console.log(
      `[Cluster ${process.env.pm_id}][${account.username}][Initialize] Visiting Reddit home page`
    );
    await page.goto("https://reddit.com");

    return new RedditCrossposterBot(
      page,
      browser,
      cursor,
      account,
      chatGptClient,
      captchaTimeoutMs,
      captchaPollingIntervalMs,
      historyDB,
      postDB,
      subredditDB,
      uploader
    );
  }

  async start(): Promise<void> {
    if (!(await this.isLoggedIn())) {
      await this.login();
    }

    const actions = _.shuffle([
      { name: BotAction.READ_RANDOM_POST, chance: 1, from: 1, to: 2 },
      { name: BotAction.TURN_ON_NSFW, chance: 1 },
      { name: BotAction.CROSS_POST, chance: 1 },
    ]);
    for (const action of actions) {
      await this.startAction(action);
    }

    this.account.cookie = JSON.stringify(await this.page.cookies());
  }

  private async startAction(action: {
    name: BotAction;
    from?: number;
    to?: number;
    chance: number;
  }): Promise<void> {
    if (Math.random() > action.chance) {
      return;
    }
    switch (action.name) {
      case BotAction.READ_RANDOM_POST: {
        await this.readRandomPosts(randint(action.from, action.to));
        break;
      }
      case BotAction.TURN_ON_NSFW: {
        if (!this?.account?.isNSFW) {
          await this.turnOnNSFW();
          this.account.isNSFW = true;
        }
        break;
      }
      case BotAction.CROSS_POST: {
        await this.crosspost();
      }
    }
  }

  async crosspost(): Promise<void> {
    // Go to target subreddit
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Getting a subreddit to crosspost`
    );
    const targetSubreddit = await this.subredditDB.getSubredditToCrosspost();
    await this.visitSubreddit(targetSubreddit);
    await delay(randint(5000, 10000));

    // Get all posts
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Getting all post titles`
    );
    const allPostTitles = (await this.page.$$(
      `.Post:not(.promotedlink) h3`
    )) as ElementHandle<Element>[];

    // Choose a random post
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Select a random post title`
    );
    let randomPostTitle = choice(allPostTitles);
    const postTitle = await this.page.evaluate(
      (el) => el.textContent,
      randomPostTitle
    );

    // Scroll to that element
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Scrolling to that post title`
    );
    await this._scrollToElement(randomPostTitle);
    await delay(randint(2000, 5000));

    // Click on that element
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking on that post`
    );
    await this.cursor.move(randomPostTitle, { paddingPercentage: 45 });
    await this.cursor.click();

    // Wait for overlay to be appeared
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Waiting for postbox`
    );
    const postBox = await this.page.waitForSelector(`#overlayScrollContainer`, {
      visible: true,
      timeout: 60000,
    });

    // Getting current post Id
    const postId = this.getPostIdFromUrl(this.page.url());

    // Simulate reading
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Delay to simulate reading`
    );
    await delay(randint(5000, 15000));

    // Click on Share
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking on Share`
    );
    await this.cursor.move(
      await this.page.waitForSelector(
        `div[data-test-id="post-content"] button[data-click-id="share"]`,
        {
          visible: true,
          timeout: 15000,
        }
      ),
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();

    // Click on Crosspost
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking Crosspost`
    );
    await this.cursor.move(
      (await this.page.waitForXPath(`//span[text()="crosspost"]`, {
        visible: true,
        timeout: 5000,
      })) as ElementHandle<Element>,
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();
    await delay(randint(2000, 3000));

    // Handle a new opening tab
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Getting new tab`
    );
    const browser = await this.browser.getBrowser();
    const pages = await browser.pages();
    this.page = pages[pages.length - 1];
    await this.page.bringToFront();
    // Re-create cursor
    this.cursor = createCursor(this.page, await getRandomPagePoint(this.page));
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Waiting for new tab navigation`
    );

    // Getting a subreddit to crosspost to
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Getting a subreddit to crosspost to`
    );
    const crosspostToSubreddit =
      (await this.subredditDB.getSubredditToCrosspostToByPostId(postId)) ||
      (await this.subredditDB.getSubredditToCrosspostTo(targetSubreddit));

    // Waiting for a new tab
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Waiting for new tab to load`
    );
    await this.page.waitForSelector(`a[data-click-id="subreddit"]`, {
      visible: true,
      timeout: 15000,
    });
    await delay(randint(2000, 5000));

    // Click choose community
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking on Community`
    );
    await this.cursor.move(
      await this.page.waitForSelector(
        `input[placeholder="Choose a community"]`,
        { visible: true, timeout: 60000 }
      ),
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();
    await delay(randint(1000, 2000));

    // Type the subreddit name
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Typing subreddit to crosspost to`
    );
    await this._type(crosspostToSubreddit.name);
    await delay(randint(500, 1000));

    // Click out side
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking outside`
    );
    await this.cursor.move(
      (await this.page.waitForXPath(
        `//div[contains(text(), "Crossposting to Reddit")]`,
        {
          visible: true,
          timeout: 15000,
        }
      )) as ElementHandle<Element>,
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();

    // Waiting for subreddit to load
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Waiting for crosspost to subreddit to load`
    );
    await this.page.waitForSelector(
      `a[href*="${crosspostToSubreddit.name}" i]`,
      {
        visible: true,
        timeout: 60000,
      }
    );
    await delay(randint(2000, 5000));

    // Enable NSFW
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Enabling NSFW`
    );
    await this.cursor.move(
      await this.page.waitForSelector(
        `button[aria-label="Mark as Not Safe For Work"]:not([disabled])`,
        {
          timeout: 15000,
          visible: true,
        }
      ),
      { paddingPercentage: 45 }
    );
    await this.cursor.click();
    await delay(randint(1000, 2000));

    // Check Flair option
    const flairBtn = await this.page.$(
      `button[aria-label="Add flair"]:not([disabled])`
    );
    if (flairBtn) {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking Flair button`
      );
      await this.cursor.move(flairBtn, { paddingPercentage: 45 });
      await this.cursor.click();
      await delay(randint(1000, 2000));

      // Get list of flairs
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Getting a list of flairs`
      );
      await this.page.waitForSelector(`div[aria-label="flair_picker"] span`, {
        timeout: 15000,
        visible: true,
      });
      const flairElements = await this.page.$$(
        `div[aria-label="flair_picker"] span`
      );
      const flairList = await Promise.all(
        flairElements.map(async (flairElement) => {
          return await this.page.evaluate((el) => el.textContent, flairElement);
        })
      );
      console.log(
        `[Cluster ${process.env.pm_id}][${
          this.account.username
        }][Crosspost] Flair list: [${flairList.join("|")}]`
      );

      // Pick a best flair
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Choosing best flair`
      );
      const bestFlair = await this.chatGptClient.chooseBestFlair({
        postTitle: postTitle,
        flairList: flairList,
      });
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Best flair: ${bestFlair}`
      );

      // Click best flair
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Selecting flair: ${bestFlair}`
      );
      for (const flairElement of flairElements) {
        const currentText = await this.page.evaluate(
          (el) => el.textContent,
          flairElement
        );
        if (currentText.toLowerCase() == bestFlair.toLowerCase()) {
          await this.cursor.move(flairElement, { paddingPercentage: 45 });
          await this.cursor.click();
          await delay(randint(1000, 2000));
          break;
        }
      }

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking Apply`
      );
      await this.cursor.move(
        (await this.page.waitForXPath(`//button[text() = "Apply"]`, {
          visible: true,
          timeout: 15000,
        })) as ElementHandle<Element>,
        { paddingPercentage: 45 }
      );
      await this.cursor.click();
      await delay(randint(1000, 2000));
    }

    // Click post
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Clicking Post`
    );
    await this.cursor.move(
      (await this.page.waitForXPath(
        `//button[text() = "Post" and not(@disabled) and @role='button']`,
        {
          visible: true,
          timeout: 5000,
        }
      )) as ElementHandle<Element>,
      { paddingPercentage: 45 }
    );
    await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);

    // Saving history
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Saving history`
    );
    await this.historyDB.add({
      action: HistoryAction.CROSS_POST,
      author: this.account,
      postId: postId,
      targetSubreddit: crosspostToSubreddit.name,
    });
    await delay(randint(5000, 15000));

    // Switching back page to origin
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Switching back to first tab`
    );
    this.page = (await browser.pages())[1];
    await this.page.bringToFront();
    // Re-create cursor
    this.cursor = createCursor(this.page, await getRandomPagePoint(this.page));

    if (!this.account.emailVerified) {
      try {
        console.log(
          `[Cluster ${process.env.pm_id}][Crosspost] Clicking for 'Got it' button 1`
        );
        const gotIt1 = await this.page.waitForXPath(
          `//button[text() = 'Got it']`,
          {
            timeout: 3000,
            visible: true,
          }
        );
        await this.cursor.move(gotIt1 as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();

        console.log(
          `[Cluster ${process.env.pm_id}][Crosspost] Clicking for 'Got it' button 2`
        );
        const gotIt2 = await this.page.waitForXPath(
          `//button[text() = 'Got it']`,
          {
            timeout: 15000,
            visible: true,
          }
        );
        await delay(randint(2000, 3000));
        await this.cursor.move(gotIt2 as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
      } catch {}

      // Close the box
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Closing the post box`
      );
      await this.cursor.move(
        (await this.page.waitForXPath(`//span[text()="Close"]`, {
          visible: true,
          timeout: 15000,
        })) as ElementHandle<Element>
      );
      await this.cursor.click();

      // Wait for postBox disappeared
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Waiting for post box to be disappeared`
      );
      await this.page.waitForSelector(`#overlayScrollContainer`, {
        hidden: true,
        timeout: 15000,
      });

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Crosspost] Scrolling for a while`
      );
      await this._simulateScroll(randint(5, 10));
    }
  }

  async turnOnNSFW(): Promise<void> {
    try {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Go to settings page`
      );
      await this.cursor.move(
        await this.page.waitForSelector(`#USER_DROPDOWN_ID`, {
          visible: true,
          timeout: 5000,
        }),
        {
          paddingPercentage: 45,
        }
      );
      await this.cursor.click();
      await delay(randint(1000, 2000));

      await this.cursor.move(
        (await this.page.waitForXPath(`//span[text()="User Settings"]`, {
          timeout: 5000,
          visible: true,
        })) as ElementHandle<Element>,
        {
          paddingPercentage: 45,
        }
      );
      await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);
      await delay(randint(1000, 2000));

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Clicking Profile tab`
      );
      await this.cursor.move(
        (await this.page.waitForXPath(`//a[text()="Profile"]`, {
          visible: true,
          timeout: 15000,
        })) as ElementHandle<Element>,
        {
          paddingPercentage: 45,
        }
      );
      await this.cursor.click();
      await delay(randint(1000, 2000));

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Enabling Profile/NSFW`
      );
      const nsfwLabel = await this.page.waitForXPath('//h3[text()="NSFW"]/..', {
        visible: true,
        timeout: 15000,
      });
      const nsfwLabelForValue = await this.page.evaluate(
        (el) => (el as any).getAttribute("for"),
        nsfwLabel
      );

      // Check if it's already on
      const nsfwButton = await this.page.waitForXPath(
        `//button[@id='${nsfwLabelForValue}']`,
        { visible: true, timeout: 15000 }
      );
      const nsfwTurnedOn = await this.page.evaluate(
        (el) => (el as any).getAttribute("aria-checked"),
        nsfwButton
      );

      if (nsfwTurnedOn != "true") {
        await this.cursor.move(nsfwButton as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
        await delay(randint(2000, 5000));
      }

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Clicking Feed Settings tab`
      );
      const feedSettingsButton = await this.page.waitForXPath(
        "//a[text()='Feed Settings']",
        { visible: true, timeout: 15000 }
      );
      await this.cursor.move(feedSettingsButton as ElementHandle<Element>, {
        paddingPercentage: 45,
      });
      await this.cursor.click();
      await delay(randint(1000, 2000));

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Enabling Feed Settings/Adult Content`
      );
      const adultContentLabel = await this.page.waitForXPath(
        '//h3[text()="Adult content"]/..',
        { visible: true, timeout: 15000 }
      );
      const adultContentLabelForValue = await this.page.evaluate(
        (el) => (el as any).getAttribute("for"),
        adultContentLabel
      );
      // Check if it's already on
      const adultContentButton = await this.page.waitForXPath(
        `//button[@id='${adultContentLabelForValue}']`,
        { visible: true, timeout: 15000 }
      );
      const adultContentTurnedOn = await this.page.evaluate(
        (el) => (el as any).getAttribute("aria-checked"),
        adultContentButton
      );

      if (adultContentTurnedOn != "true") {
        await this.cursor.click(adultContentButton as ElementHandle<Element>, {
          paddingPercentage: 20,
        });
        await delay(randint(2000, 5000));
      }

      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Successfully`
      );
    } catch (err) {
      console.error(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Turn on NSFW] Failed, ` +
          err
      );
    }
  }

  private async visitSubreddit(subreddit: ISubredditEntity) {
    try {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] ${subreddit.name}`
      );

      // Checking if there's a filter on search bar
      const removeFilterBtn = await this.page.$(
        `button[aria-label="Remove community search filter"]`
      );
      if (removeFilterBtn) {
        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Remove filter on search bar`
        );
        await this.cursor.move(removeFilterBtn, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
        await delay(randint(500, 1000));
      }

      // Click on search bar
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Clicking on search bar`
      );
      await this.cursor.move(
        await this.page.waitForSelector(`input#header-search-bar`, {
          visible: true,
          timeout: 15000,
        })
      );
      await this.cursor.click();
      await delay(randint(500, 1000));

      // Check if there's a subreddit on search
      try {
        const subredditLink = await this.page.waitForSelector(
          `#SearchDropdownContent a[href*="${subreddit.name}" i]`,
          { visible: true, timeout: 5000 }
        );
        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Found target subreddit on search bar, clicking`
        );
        await this.cursor.move(subredditLink, {
          paddingPercentage: 45,
        });
        await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);

        // Wait for first post to load
        await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
          visible: true,
          timeout: 60000,
        });
        return;
      } catch {}

      // Type subreddit name
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Typing subreddit`
      );
      await this._type(subreddit.name);
      await delay(randint(500, 1000));

      // To show NSFW Communities
      try {
        const expandBtn = await this.page.waitForXPath(`//p[text()="Expand"]`, {
          visible: true,
          timeout: 5000,
        });
        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Clicking Expand`
        );
        await this.cursor.move(expandBtn as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
      } catch {}
      await delay(randint(500, 1000));

      // Click on Subreddit
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Clicking on Subreddit`
      );
      await this.cursor.move(
        await this.page.waitForSelector(
          `#SearchDropdownContent a[aria-label='${subreddit.name}' i]`,
          { timeout: 15000, visible: true }
        )
      );

      // Waiting for navigation
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Waiting for navigation`
      );
      await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);

      // Wait for first post to load
      await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
        visible: true,
        timeout: 60000,
      });
    } catch (err) {
      console.error(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Visit Subreddit] Failed, trying direct link - ` +
          err
      );
      await this.page.goto(`https://reddit.com/${subreddit.name}/`);
      // Wait for first post to load
      await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
        visible: true,
        timeout: 60000,
      });
    }
  }

  async readRandomPosts(numPosts: number = 1) {
    let numReadPosts = 0;
    await this.returnHome();
    await delay(randint(1000, 3000));

    while (numReadPosts < numPosts) {
      try {
        // Scrolling for a while
        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Scrolling until find a post`
        );
        await this._simulateScroll(randint(5, 10));

        // Scroll until find a post to read
        const findPostTimeoutMs = 120000;
        const findPostStartTime = Date.now();
        while (true) {
          const allPostTitles = (await this.page.$$(
            `.Post:not(.promotedlink) h3`
          )) as ElementHandle<Node>[];
          const tempPost = (await findAsync(
            allPostTitles,
            async (el) => await el.isIntersectingViewport()
          )) as ElementHandle<Node>;
          allPostTitles.splice(allPostTitles.indexOf(tempPost), 1);
          const currentPost = (await findAsync(
            allPostTitles,
            async (el) => await el.isIntersectingViewport()
          )) as ElementHandle<Node>;
          if (currentPost) {
            await delay(randint(1000, 2000));
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Clicking on a post`
            );
            await delay(randint(1000, 2000));
            await this.cursor.move(currentPost as ElementHandle<Element>, {
              paddingPercentage: 45,
            });
            await this.cursor.click();

            // Wait for overlay to be appeared
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Waiting for post box`
            );
            const postBox = await this.page.waitForSelector(
              `#overlayScrollContainer`,
              {
                visible: true,
                timeout: 60000,
              }
            );

            // Simulate reading
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Delay to simulate reading`
            );
            await delay(randint(5000, 15000));

            // Scroll for a while
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Scrolling post box`
            );
            await this._simulateScroll(randint(3, 5), postBox);
            await delay(randint(1000, 2000));

            // Close the box
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Closing the post box`
            );
            await this.cursor.move(
              (await this.page.waitForXPath(`//span[text()="Close"]`, {
                visible: true,
                timeout: 15000,
              })) as ElementHandle<Element>
            );
            await this.cursor.click();

            // Wait for postBox disappeared
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Waiting for post box to be disappeared`
            );
            await this.page.waitForSelector(`#overlayScrollContainer`, {
              hidden: true,
              timeout: 15000,
            });
            await delay(randint(1000, 2000));
            break;
          } else {
            const now = Date.now();
            if (now - findPostStartTime >= findPostTimeoutMs) {
              throw new Error(
                `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Failed, find post to click timed out`
              );
            }
            console.log(
              `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Didn't find a post yet, scroll for a little more`
            );
            await this._simulateScroll(randint(1, 3));
          }
        }

        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Finished reading a post, scroll for a little more`
        );
        await this._simulateScroll(randint(10, 15));
      } catch (err) {
        console.error(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Read Random Posts] Failed, ` +
            err
        );
      } finally {
        ++numReadPosts;
      }
    }
  }

  private async returnHome() {
    try {
      if (this.page.url() != "https://www.reddit.com/") {
        console.log(
          `[Cluster ${process.env.pm_id}][${this.account.username}][Return Home] Clicking on Logo`
        );
        const logo = await this.page.waitForSelector(`a[aria-label="Home"]`, {
          timeout: 3000,
          visible: true,
        });
        await this.cursor.move(logo, { paddingPercentage: 45 });
        await Promise.all([this.page.waitForNavigation(), this.cursor.click()]);
      }
    } catch (err) {
      console.error(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Return Home] Failed -> Trying direct link, `,
        +err
      );
      await this.page.goto("https://www.reddit.com/");
    }
  }

  async isLoggedIn(): Promise<boolean> {
    const loginBtn = (await this.page.$x(`//a[text()="Log In"]`))?.[0];
    if (loginBtn) {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Is Logged In] No`
      );
      return false;
    } else {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Is Logged In] Yes`
      );
      return true;
    }
  }

  async login(): Promise<void> {
    const loginBtn = (await this.page.$x(`//a[text()="Log In"]`))?.[0];

    if (loginBtn) {
      // Click login button
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Click login button on homepage`
      );
      await this.cursor.move(loginBtn as ElementHandle<Element>, {
        paddingPercentage: 45,
      });
      await this.cursor.click();

      // Wait for login frame to load
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Waiting for login frame to load`
      );
      const loginFrameHandle = await this.page.waitForSelector(
        'iframe[src^="https://www.reddit.com/login"]',
        { timeout: 60000 }
      );
      const loginFrame = await loginFrameHandle.contentFrame();
      await delay(randint(3000, 6000));

      // Type username
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Typing username`
      );
      const usernameInput = await loginFrame.waitForSelector(
        `input#loginUsername`
      );
      await this.cursor.move(usernameInput, { paddingPercentage: 45 });
      await this.cursor.click();
      await delay(randint(500, 1500));
      await loginFrame.focus(`input#loginUsername`);
      await this._type(this.account.username);
      await delay(randint(500, 1500));

      // Type password
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Typing password`
      );
      const passwordInput = await loginFrame.waitForSelector(
        `input#loginPassword`
      );
      await this.cursor.move(passwordInput, { paddingPercentage: 45 });
      await this.cursor.click();
      await delay(randint(500, 1500));
      await loginFrame.focus(`input#loginPassword`);
      await this._type(this.account.password);
      await delay(randint(500, 1500));

      // Click Sign in
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Clicking Login`
      );
      await this.cursor.move(
        (await loginFrame.waitForXPath(`//button[contains(text(), "Log In")]`, {
          timeout: 15000,
          visible: true,
        })) as ElementHandle<Element>,
        {
          paddingPercentage: 45,
        }
      );
      this.page.on("response", this._onLoginResponse.bind(this)); // Listening to login response
      await this.cursor.click();
      await this._checkLoginResult();
      this.page.off("response", this._onLoginResponse.bind(this)); // Off login response
      await this.page.waitForNavigation();
    } else {
      throw new Error(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Didn't find login button`
      );
    }
  }

  private async _checkLoginResult() {
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Waiting for login result`
    );
    const startTime = Date.now();
    const timeoutMs = 120000;
    while (!this.loginResult) {
      const now = Date.now();
      if (now - startTime >= timeoutMs) {
        throw new Error(
          `[BOT][${this.account.username}][Login] Failed, timed out`
        );
      }
      await delay(100);
    }

    if (this.loginResult?.message) {
      throw new Error(
        `[BOT][${this.account.username}][Login] Failed, ${this.loginResult.message}`
      );
    } else {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Login] Successfully`
      );
    }
  }

  private async _onLoginResponse(response: HTTPResponse) {
    const url = response.url();

    if (
      url.startsWith("https://www.reddit.com/login") &&
      response.request().method() == "POST"
    ) {
      if (response.status() == 200) {
        this.loginResult = {
          status: true,
        };
      } else {
        const body = await response.json();
        this.loginResult = {
          status: false,
          message: body?.reason,
        };
      }
    }
  }

  private async _pressKeyboard(keyInput: KeyInput) {
    await this.page.keyboard.press(keyInput);
    await delay(randint(300, 1000));
  }

  private async _type(text: string) {
    const needsShiftKey = '~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
    const splittedText = text.split(/(\n)/g);

    for (const part of splittedText) {
      if (!part) continue;
      if (part == "\n") {
        await this._pressKeyboard("Enter");
        continue;
      }
      for (let ch of part) {
        let needsShift = false;
        if (needsShiftKey.includes(ch)) {
          needsShift = true;
          await this.page.keyboard.down("ShiftLeft");
          await delay(randint(500, 1000));
        }

        await this.page.keyboard.type("" + ch, { delay: randint(30, 100) });

        if (needsShift) {
          await delay(randint(150, 450));
          await this.page.keyboard.up("ShiftLeft");
        }

        await delay(randint(30, 100));
      }
    }

    await delay(randint(300, 1000));
  }

  private async _scrollToElement(element: ElementHandle<Element>) {
    await this.page.evaluate((el) => {
      const yOffset = -100;
      const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
      // el.scrollIntoView({ behavior: "smooth" });
    }, element);
  }

  private async _simulateScroll(
    stepsLimit: number,
    scrollElement?: ElementHandle<Element>
  ) {
    for (let i = 0; i < stepsLimit; i++) {
      await this._scroll({
        size: randint(50, 350),
        delay: 0,
        stepsLimit: 1,
        scrollElement: scrollElement,
      });
      await delay(randint(300, 1000));
    }
  }

  private async _scroll(opts: {
    size?: number;
    delay?: number;
    stepsLimit?: number | null;
    direction?: "top" | "bottom";
    scrollElement?: ElementHandle<Element>;
  }) {
    const {
      size = 250,
      delay = 100,
      stepsLimit = null,
      direction = "bottom",
      scrollElement,
    } = opts;
    let lastScrollPosition = await this.page.evaluate(
      async (
        pixelsToScroll,
        delayAfterStep,
        limit,
        direction,
        scrollElement
      ) => {
        let getElementScrollHeight = (element) => {
          if (!element) return 0;
          let { scrollHeight, offsetHeight, clientHeight } = element;
          return Math.max(scrollHeight, offsetHeight, clientHeight);
        };

        let initialScrollPosition = window.pageYOffset;
        let availableScrollHeight = scrollElement
          ? getElementScrollHeight(scrollElement)
          : getElementScrollHeight(document.body);
        let lastPosition = direction === "bottom" ? 0 : initialScrollPosition;
        const scrollObj = scrollElement ? scrollElement : window;

        let scrollFn = (resolve) => {
          let intervalId = setInterval(() => {
            scrollObj.scrollBy(
              0,
              direction === "bottom" ? pixelsToScroll : -pixelsToScroll
            );
            lastPosition +=
              direction === "bottom" ? pixelsToScroll : -pixelsToScroll;

            if (
              (direction === "bottom" &&
                lastPosition >= availableScrollHeight) ||
              (direction === "bottom" &&
                limit !== null &&
                lastPosition >= pixelsToScroll * limit) ||
              (direction === "top" && lastPosition <= 0) ||
              (direction === "top" &&
                limit !== null &&
                lastPosition <= initialScrollPosition - pixelsToScroll * limit)
            ) {
              clearInterval(intervalId);
              resolve(lastPosition);
            }
          }, delayAfterStep);
        };

        return new Promise(scrollFn);
      },
      size,
      delay,
      stepsLimit,
      direction,
      scrollElement
    );

    return lastScrollPosition;
  }

  private async solveCaptcha() {
    console.log(
      `[Cluster ${process.env.pm_id}][${this.account.username}][Solve Captcha] Running`
    );
    let captcha: any;
    try {
      captcha = await this.page.waitForSelector(
        "textarea#g-recaptcha-response",
        { timeout: 10000 }
      );
    } catch {}
    const startTime = Date.now();
    if (captcha) {
      do {
        try {
          captcha = await this.page.$("textarea#g-recaptcha-response");
          if (!captcha) {
            break;
          }

          const value = (
            await captcha.evaluate((el) => (el as any).value)
          )?.trim();
          if (value?.length) {
            break;
          }
        } catch {}

        const now = Date.now();
        if (now - startTime >= this.captchaTimeoutMs) {
          throw new Error(
            `[Cluster ${process.env.pm_id}][${this.account.username}][Solve Captcha] Timed out`
          );
        }
        await delay(this.captchaPollingIntervalMs);
      } while (true);
    } else {
      console.log(
        `[Cluster ${process.env.pm_id}][${this.account.username}][Solve Captcha] No action needed`
      );
    }
  }

  private getPostIdFromUrl(url: string): string {
    return url.split("/")[6];
  }

  static async getIdFromUsername(username: string): Promise<string> {
    try {
      const { body } = await request(
        `https://www.reddit.com/user/${username}/about.json`
      );
      const data = (await body.json()).data;
      return data.id;
    } catch {
      return username;
    }
  }
}
