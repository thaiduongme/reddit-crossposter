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
  logInfo,
  logError,
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

    await logInfo(`[Initialize] Visiting Reddit home page`);
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
    await logInfo(`[Crosspost] Getting a subreddit to crosspost`);
    const targetSubreddit = await this.subredditDB.getSubredditToCrosspost();
    if (!targetSubreddit) {
      throw new Error("[Crosspost] Couldn't find a subreddit to crosspost");
    }
    await logInfo(
      `[Crosspost] Subreddit to crosspost: ${targetSubreddit.name}`
    );
    await logInfo(`[Crosspost] Visiting target subreddit`);
    await this.visitSubreddit(targetSubreddit);
    await delay(randint(5000, 10000));

    // Scroll and click a random post
    await logInfo(`[Crosspost] Scrolling and click a random post`);
    const postBox = await this._scrollAndClickARandomPost();

    // Get postId & title
    await logInfo(`[Crosspost] Getting postId and post title`);
    const postId = this.getPostIdFromUrl(this.page.url());
    const postTitle = await this.page.evaluate(
      (el) => el.textContent,
      await this.page.waitForSelector(`div[data-test-id="post-content"] h1`, {
        timeout: 15000,
      })
    );
    await logInfo(`[Crosspost] Cross-posting post: ${postTitle}`);

    // Scroll postbox for a while
    await logInfo(`[Crosspost] Scrolling post content for a little`);
    await this._simulateScroll(randint(3, 5), postBox);
    await delay(randint(1000, 2000));

    // Scroll back to the top
    await logInfo(`[Crosspost] Scrolling back to the top`);
    await this._scroll({
      size: randint(150, 300),
      delay: randint(300, 1000),
      direction: "top",
      scrollElement: postBox,
    });
    await delay(randint(1000, 2000));

    // Click on Share
    await logInfo(`[Crosspost] Clicking 'Share'`);
    await this.cursor.move(
      await this.page.waitForSelector(
        `div[data-test-id="post-content"] button[data-click-id="share"]`,
        {
          timeout: 15000,
        }
      ),
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();
    await delay(randint(500, 1000));

    // Click on Crosspost
    await logInfo(`[Crosspost] Clicking 'Crosspost'`);
    await this.cursor.move(
      (await this.page.waitForXPath(`//span[text()="crosspost"]`, {
        timeout: 5000,
      })) as ElementHandle<Element>,
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();
    await delay(randint(2000, 3000));

    // Handle a new opening tab
    await logInfo(`[Crosspost] Getting new tab`);
    const browser = await this.browser.getBrowser();
    const pages = await browser.pages();
    this.page = pages[pages.length - 1];
    await this.page.bringToFront();
    // Re-create cursor
    await logInfo(`[Crosspost] Re-creating a new cursor`);
    this.cursor = createCursor(this.page, await getRandomPagePoint(this.page));
    await logInfo(`[Crosspost] Waiting for new tab navigation`);

    // Getting a subreddit to crosspost to
    await logInfo(`[Crosspost] Getting a subreddit to crosspost to`);
    const crosspostToSubreddit =
      (await this.subredditDB.getSubredditToCrosspostToByPostId(postId)) ||
      (await this.subredditDB.getSubredditToCrosspostTo(targetSubreddit));
    await logInfo(
      `[Crosspost] Crosspost to subreddit: ${crosspostToSubreddit.name}`
    );

    // Waiting for a new tab
    await logInfo(`[Crosspost] Waiting for new tab to load`);
    await this.page.waitForSelector(`a[data-click-id="subreddit"]`, {
      timeout: 15000,
    });
    await delay(randint(2000, 5000));

    // Click choose community
    await logInfo(`[Crosspost] Clicking on Community`);
    await this.cursor.move(
      await this.page.waitForSelector(
        `input[placeholder="Choose a community"]`,
        { timeout: 60000 }
      ),
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();
    await delay(randint(1000, 2000));

    // Type the subreddit name
    await logInfo(`[Crosspost] Typing subreddit to crosspost to`);
    await this._type(crosspostToSubreddit.name);
    await delay(randint(500, 1000));

    // Click out side
    await logInfo(`[Crosspost] Clicking outside`);
    await this.cursor.move(
      (await this.page.waitForXPath(
        `//div[contains(text(), "Crossposting to Reddit")]`,
        {
          timeout: 15000,
        }
      )) as ElementHandle<Element>,
      {
        paddingPercentage: 45,
      }
    );
    await this.cursor.click();

    // Waiting for subreddit to load
    await logInfo(`[Crosspost] Waiting for crosspost to subreddit to load`);
    await this.page.waitForSelector(
      `a[href*="${crosspostToSubreddit.name}" i]`,
      {
        timeout: 60000,
      }
    );
    await delay(randint(2000, 5000));

    // Enable NSFW
    await logInfo(`[Crosspost] Enabling NSFW`);
    await this.cursor.move(
      await this.page.waitForSelector(
        `button[aria-label="Mark as Not Safe For Work"]:not([disabled])`,
        {
          timeout: 15000,
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
      await logInfo(`[Crosspost] Clicking Flair button`);
      await this.cursor.move(flairBtn, { paddingPercentage: 45 });
      await this.cursor.click();
      await delay(randint(1000, 2000));

      // Get list of flairs
      await logInfo(`[Crosspost] Getting a list of flairs`);
      await this.page.waitForSelector(`div[aria-label="flair_picker"] span`, {
        timeout: 15000,
      });
      const flairElements = await this.page.$$(
        `div[aria-label="flair_picker"] span`
      );
      const flairList = await Promise.all(
        flairElements.map(async (flairElement) => {
          return await this.page.evaluate((el) => el.textContent, flairElement);
        })
      );
      await logInfo(`[Crosspost] Flair list: [${flairList.join("|")}]`);

      // Pick a best flair
      await logInfo(`[Crosspost] Choosing best flair`);
      const bestFlair = await this.chatGptClient.chooseBestFlair({
        postTitle: postTitle,
        flairList: flairList,
      });
      await logInfo(`[Crosspost] Best flair: ${bestFlair}`);

      // Click best flair
      await logInfo(`[Crosspost] Selecting flair: ${bestFlair}`);
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

      await logInfo(`[Crosspost] Clicking Apply`);
      await this.cursor.move(
        (await this.page.waitForXPath(`//button[text() = "Apply"]`, {
          timeout: 15000,
        })) as ElementHandle<Element>,
        { paddingPercentage: 45 }
      );
      await this.cursor.click();
      await delay(randint(1000, 2000));
    }

    // Click post
    await logInfo(`[Crosspost] Clicking Post`);
    await this.cursor.move(
      (await this.page.waitForXPath(
        `//button[text() = "Post" and not(@disabled) and @role='button']`,
        {
          timeout: 5000,
        }
      )) as ElementHandle<Element>,
      { paddingPercentage: 45 }
    );
    await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);

    // Saving history
    await logInfo(`[Crosspost] Saving history`);
    await this.historyDB.add({
      action: HistoryAction.CROSS_POST,
      author: this.account,
      postId: postId,
      targetSubreddit: crosspostToSubreddit.name,
    });

    // Delay for a while after post
    await logInfo(`[Crosspost] Delay for a while after crosspost`);
    await delay(randint(5000, 15000));

    // Switching back page to origin
    await logInfo(`[Crosspost] Switching back to first tab`);
    this.page = (await browser.pages())[1];
    await this.page.bringToFront();
    // Re-create cursor
    await logInfo(`[Crosspost] Re-creating the cursor`);
    this.cursor = createCursor(this.page, await getRandomPagePoint(this.page));

    await logInfo(`[Crosspost] Closing the postbox`);
    await this._closePostBox();

    await logInfo(`[Crosspost] Scrolling for a while after crosspost`);
    await this._simulateScroll(randint(3, 5));
  }

  async turnOnNSFW(): Promise<void> {
    try {
      await logInfo("[Turn on NSFW] Go to Settings page");
      await this.cursor.move(
        await this.page.waitForSelector(`#USER_DROPDOWN_ID`, {
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
        })) as ElementHandle<Element>,
        {
          paddingPercentage: 45,
        }
      );
      await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);
      await delay(randint(1000, 2000));

      await logInfo("[Turn on NSFW] Clicking Profile tab");
      await this.cursor.move(
        (await this.page.waitForXPath(`//a[text()="Profile"]`, {
          timeout: 15000,
        })) as ElementHandle<Element>,
        {
          paddingPercentage: 45,
        }
      );
      await this.cursor.click();
      await delay(randint(1000, 2000));

      await logInfo("[Turn on NSFW] Enabling Profile/NSFW");
      const nsfwLabel = await this.page.waitForXPath('//h3[text()="NSFW"]/..', {
        timeout: 15000,
      });
      const nsfwLabelForValue = await this.page.evaluate(
        (el) => (el as any).getAttribute("for"),
        nsfwLabel
      );

      // Check if it's already on
      const nsfwButton = await this.page.waitForXPath(
        `//button[@id='${nsfwLabelForValue}']`,
        { timeout: 15000 }
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

      await logInfo("[Turn on NSFW] Clicking Feed Settings tab");
      const feedSettingsButton = await this.page.waitForXPath(
        "//a[text()='Feed Settings']",
        { timeout: 15000 }
      );
      await this.cursor.move(feedSettingsButton as ElementHandle<Element>, {
        paddingPercentage: 45,
      });
      await this.cursor.click();
      await delay(randint(1000, 2000));

      await logInfo("[Turn on NSFW] Enabling Feed Settings/Adult Content");
      const adultContentLabel = await this.page.waitForXPath(
        '//h3[text()="Adult content"]/..',
        { timeout: 15000 }
      );
      const adultContentLabelForValue = await this.page.evaluate(
        (el) => (el as any).getAttribute("for"),
        adultContentLabel
      );
      // Check if it's already on
      const adultContentButton = await this.page.waitForXPath(
        `//button[@id='${adultContentLabelForValue}']`,
        { timeout: 15000 }
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
    } catch (err) {
      await logError("[Turn on NSFW] Failed, " + err);
    }
  }

  private async visitSubreddit(subreddit: ISubredditEntity) {
    try {
      await logInfo(`[Visit Subreddit] ${subreddit.name}`);

      // Checking if there's a filter on search bar
      const removeFilterBtn = await this.page.$(
        `button[aria-label="Remove community search filter"]`
      );
      if (removeFilterBtn) {
        await logInfo(`[Visit Subreddit] Remove filter on search bar`);
        await this.cursor.move(removeFilterBtn, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
        await delay(randint(500, 1000));
      }

      // Click on search bar
      await logInfo(`[Visit Subreddit] Clicking on search bar`);
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
        await logInfo(
          `[Visit Subreddit] Found target subreddit on search bar, clicking`
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
      await logInfo(`[Visit Subreddit] Typing subreddit`);
      await this._type(subreddit.name);
      await delay(randint(500, 1000));

      // To show NSFW Communities
      try {
        const expandBtn = await this.page.waitForXPath(`//p[text()="Expand"]`, {
          visible: true,
          timeout: 5000,
        });
        await logInfo(`[Visit Subreddit] Clicking Expand`);
        await this.cursor.move(expandBtn as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();
      } catch {}
      await delay(randint(500, 1000));

      // Click on Subreddit
      await logInfo(`[Visit Subreddit] Clicking on Subreddit`);
      await this.cursor.move(
        await this.page.waitForSelector(
          `#SearchDropdownContent a[aria-label='${subreddit.name}' i]`,
          { timeout: 15000, visible: true }
        )
      );

      // Waiting for navigation
      await logInfo(`[Visit Subreddit] Waiting for navigation`);
      await Promise.all([this.cursor.click(), this.page.waitForNavigation()]);

      // Wait for first post to load
      await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
        visible: true,
        timeout: 60000,
      });
    } catch (err) {
      console.error(`[Visit Subreddit] Failed, trying direct link - ` + err);
      await this.page.goto(`https://reddit.com/${subreddit.name}/`);
      // Wait for first post to load
      await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
        visible: true,
        timeout: 60000,
      });
    }
  }

  async readRandomPosts(numPosts: number = 1) {
    let numPostRead = 0;

    while (numPostRead < numPosts) {
      try {
        await logInfo(
          `[Read Random Posts] Attempting ${numPostRead + 1}/${numPosts}`
        );

        // Return home in case it's stuck
        await logInfo(
          "[Read Random Posts] Returning home in case it's stuck somewhere"
        );
        await this._returnHome();
        await delay(randint(1000, 3000));

        // Scroll and Click a random post
        await logInfo("[Read Random Posts] Scrolling and click a random post");
        const postBox = await this._scrollAndClickARandomPost();

        // Scroll for a while
        await logInfo("[Read Random Posts] Scrolling post box content");
        await this._simulateScroll(randint(3, 8), postBox);
        await delay(randint(1000, 2000));

        // Close the post box
        await logInfo("[Read Random Posts] Closing the post box");
        await this._closePostBox();

        await logInfo(
          "[Read Random Posts] Scrolling for a little more after read a post"
        );
        await this._simulateScroll(randint(3, 8));
      } catch (err) {
        await logError("[Read Random Posts] Failed, " + err);
      }
      ++numPostRead;
    }
  }

  private async _scrollAndClickARandomPost(): Promise<ElementHandle<Element>> {
    // Waiting for posts to show up
    await logInfo("[Scroll & click random post] Waiting for posts to show up");
    try {
      await this.page.waitForSelector(`.Post:not(.promotedlink) h3`, {
        timeout: 60000,
      });
    } catch {
      throw new Error(`[Scroll & click random post] No posts found`);
    }

    // Scrolling for a while
    await logInfo("[Scroll & click random post] Scrolling for a while");
    await this._simulateScroll(randint(3, 10));

    // Select a random post

    let firstIntersectingTitle: ElementHandle<Element>;
    let secondIntersectingTitle: ElementHandle<Element>;
    let selectedPostTitle: ElementHandle<Element>;
    const MAX_SELECT_POST_RETRIES = 10;
    let numSelectPost = 0;
    while (numSelectPost < MAX_SELECT_POST_RETRIES) {
      try {
        await logInfo(
          `[Scroll & click random post] Selecting a random visible post (${
            numSelectPost + 1
          }/${MAX_SELECT_POST_RETRIES} max attempts)`
        );

        // Getting post list
        await logInfo("[Scroll & click random post] Getting post list");
        const allPostTitles = await this.page.$$(`.Post:not(.promotedlink) h3`);
        if (allPostTitles.length == 0) {
          await logError("[Scroll and Click a random post] No posts found");
          return;
        }
        await logInfo(
          `[Scroll & click random post] Total: ${allPostTitles.length} post(s)`
        );

        // Get a post that is intersecting the viewport
        await logInfo(`[Scroll & click random post] Getting a visible post`);
        for (const postTitle of allPostTitles) {
          if (await postTitle.isIntersectingViewport()) {
            if (!firstIntersectingTitle) {
              firstIntersectingTitle = postTitle;
            } else if (firstIntersectingTitle) {
              secondIntersectingTitle = postTitle;
              break;
            }
          }
        }

        if (!firstIntersectingTitle) {
          throw new Error(
            `[Scroll & click random post] Could not find a visible post`
          );
        }
        selectedPostTitle = secondIntersectingTitle;

        if (!secondIntersectingTitle) {
          await logInfo(
            "[Scroll & click random post] Cannot find second intersecting title, choose first intersecting title"
          );
          selectedPostTitle = firstIntersectingTitle;
        }
        break;
      } catch (err) {
        await logError(err as string);
      }
      ++numSelectPost;
      await logInfo(
        "[Scroll & click random post] Have not found visible post yet, scrolling for a little more"
      );
      await this._simulateScroll(randint(1, 3));
      await delay(randint(1000, 2000));
    }

    if (!selectedPostTitle) {
      throw new Error(
        `[Scroll & click random post] Cannot find a post that is intersecting viewport, maximum retries exceeded (MAXIMUM: ${MAX_SELECT_POST_RETRIES})`
      );
    }

    await logInfo(`[Scroll & click random post] Scrolling to selected post`);
    await delay(randint(500, 1000));
    await this._scrollToElement(selectedPostTitle);

    // Delay to simulate reading
    await logInfo(
      `[Scroll & click random post] Delay to simulate reading post preview`
    );
    await delay(randint(1000, 3000));

    // Click on selected post
    await logInfo(`[Scroll & click random post] Clicking on selected post`);
    await this.cursor.move(selectedPostTitle, {
      paddingPercentage: 45,
    });
    await this.cursor.click();

    // Wait for post overlay to show up
    await logInfo(
      `[Scroll & click random post] Waiting for post box to show up`
    );
    const postBox = await this.page.waitForSelector(`#overlayScrollContainer`, {
      visible: true,
      timeout: 60000,
    });

    // Wait for post title to show up
    await logInfo(
      `[Scroll & click random post] Waiting for post title to show up`
    );
    await this.page.waitForSelector(`div[data-test-id="post-content"] h1`, {
      timeout: 60000,
    });

    // Simulate reading
    await logInfo(`[Scroll & click random post] Delay to simulate reading`);
    await delay(randint(5000, 15000));

    return postBox;
  }

  private async _closePostBox() {
    if (!this.account.emailVerified) {
      try {
        await logInfo("[Close Post Box] Checking if it has email prompt");
        const gotIt1 = await this.page.waitForXPath(
          `//button[text() = 'Got it']`,
          {
            timeout: 1000,
            visible: true,
          }
        );
        await logInfo("[Close Post Box] Clicking 'Got it' 1st time");
        await this.cursor.move(gotIt1 as ElementHandle<Element>, {
          paddingPercentage: 45,
        });
        await this.cursor.click();

        await logInfo("[Close Post Box] Clicking 'Got it' 2nd time");
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
    }

    // Close the box
    await logInfo("[Close Post Box] Clicking 'Close'");
    await this.cursor.move(
      (await this.page.waitForXPath(`//span[text()="Close"]`, {
        timeout: 15000,
      })) as ElementHandle<Element>
    );
    await this.cursor.click();

    // Wait for postBox disappeared
    await logInfo("[Close Post Box] Waiting for post box to be disappeared");
    await this.page.waitForSelector(`#overlayScrollContainer`, {
      hidden: true,
      timeout: 15000,
    });
    await delay(randint(1000, 2000));
  }

  private async _returnHome() {
    try {
      await logInfo("[Return Home] Starting");
      if (this.page.url() != "https://www.reddit.com/") {
        await logInfo(`[Return Home] Clicking on Logo`);
        const logo = await this.page.waitForSelector(`a[aria-label="Home"]`, {
          timeout: 3000,
        });
        await this.cursor.move(logo, { paddingPercentage: 45 });

        await logInfo(`[Return Home] Waiting for navigation`);
        await Promise.all([this.page.waitForNavigation(), this.cursor.click()]);
      }
    } catch (err) {
      await logError(`[Return Home] Failed, ` + err);
      await logInfo(`[Return Home] Trying direct link`);
      await this.page.goto("https://www.reddit.com/");
    }

    await logInfo(`[Return Home] Waiting for posts to show up`);
    await this.page.waitForSelector(`.Post h3`, {
      timeout: 60000,
    });
  }

  async isLoggedIn(): Promise<boolean> {
    const loginBtn = (await this.page.$x(`//a[text()="Log In"]`))?.[0];
    if (loginBtn) {
      await logInfo(`[Is Logged In] No`);
      return false;
    } else {
      await logInfo(`[Is Logged In] Yes`);
      return true;
    }
  }

  async login(): Promise<void> {
    const loginBtn = (await this.page.$x(`//a[text()="Log In"]`))?.[0];

    if (loginBtn) {
      // Click login button
      await logInfo(`[Login] Click login button on homepage`);
      await this.cursor.move(loginBtn as ElementHandle<Element>, {
        paddingPercentage: 45,
      });
      await this.cursor.click();

      // Wait for login frame to load
      await logInfo(`[Login] Waiting for login frame to load`);
      const loginFrameHandle = await this.page.waitForSelector(
        'iframe[src^="https://www.reddit.com/login"]',
        { timeout: 60000 }
      );
      const loginFrame = await loginFrameHandle.contentFrame();
      await delay(randint(3000, 6000));

      // Type username
      await logInfo(`[Login] Typing username`);
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
      await logInfo(`[Login] Typing password`);
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
      await logInfo(`[Login] Clicking Login`);
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
      throw new Error(`[Login] Didn't find login button`);
    }
  }

  private async _checkLoginResult() {
    await logInfo(`[Login] Waiting for login result`);
    const startTime = Date.now();
    const timeoutMs = 120000;
    while (!this.loginResult) {
      const now = Date.now();
      if (now - startTime >= timeoutMs) {
        throw new Error(`[BOT][Login] Failed, timed out`);
      }
      await delay(100);
    }

    if (this.loginResult?.message) {
      throw new Error(`[BOT][Login] Failed, ${this.loginResult.message}`);
    } else {
      await logInfo(`[Login] Successfully`);
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
    await logInfo(`[Solve Captcha] Running`);
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
          throw new Error(`[Solve Captcha] Timed out`);
        }
        await delay(this.captchaPollingIntervalMs);
      } while (true);
    } else {
      await logInfo(`[Solve Captcha] No action needed`);
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
