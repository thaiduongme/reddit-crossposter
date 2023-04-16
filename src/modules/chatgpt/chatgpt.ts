import axios from "axios";
import { choice, delay, logError } from "../utils/other.utils";

export class ChatGPTClient {
  constructor(
    private readonly baseApiUrl: string,
    private readonly secretKey: string
  ) {}

  async sendMessage(prompt: string): Promise<string> {
    return (
      await axios.post(`${this.baseApiUrl}/conversation`, {
        message: prompt,
        secretKey: this.secretKey,
      })
    ).data.response;
  }

  async rewriteTitle(title: string): Promise<string> {
    const numTries = 3;
    for (let i = 1; i <= numTries; i++) {
      let result: string;
      try {
        let prompt = `Rewrite original title to post on Reddit. Read & analyze some post title examples below to rewrite, because it may have the same pattern that you need to follow.\nExamples:\n1. Let'S Spend This Day In Bed\n2. Don'T You Love A Sexy Petite Brunette ;)\n3. It Is Tradition To Give A Kiss When You See A Naughty Redhead\n4. Wait For It…So Suckable They Should Be In Your Mouth.\n5. She Loves It\n\nAgain, rewrite original title. Output the following format: ~new title~ (include ~ character at the beginning and the end)\nOriginal title: ${title}`;
        result = await this.sendMessage(prompt);
        const regex = /~([^~]+)~/g;
        return regex.exec(result)[1];
      } catch (err) {
        await logError(`[ChatGPT] Failed to rewrite: ${title}` + err);
        await logError(`[ChatGPT] Response: ${result}`);
      }
      await delay(5000);
    }
    return null;
  }

  async chooseBestFlair(opts: {
    postTitle: string;
    postTags?: string[];
    flairList: string[];
  }): Promise<string> {
    const { postTitle, postTags = [], flairList } = opts;
    let prompt = `A subreddit flair is a label or tag that can be assigned to a user's username or a post in a subreddit. Flair can be used to categorize posts, showcase affiliations or expertise, and provide context for posts, such as indicating the location or language of the content or whether a post is a question or an announcement. Using flairs can help users search for specific types of content or find posts from users with specific expertise or affiliations.

    From post title and post tags & flair list, choose only 1 flair from flair list which you find the most suitable (write exactly the same word, no unnecessary capitalizing). Write the output in the format ~best flair~ (include ~ character at the beginning and the end).
    Post title: "${postTitle}"
    Post tags: [${postTags.join(", ")}]
    Flair list: [${flairList.join(", ")}]`;
    const result = await this.sendMessage(prompt);
    const regex = /~([^~]+)~/g;
    return regex.exec(result)[1];
  }

  async generateNewPostTitle(opts: {
    originalTitle: string;
    exampleTitles?: string[];
  }): Promise<string> {
    const { originalTitle, exampleTitles } = opts;
    let prompt = `Rewrite original title to post on Reddit.`;
    if (exampleTitles?.length > 0) {
      prompt += ` Read & analyze some post title examples below to rewrite, because it may have the same pattern that you need to follow.\nExamples:\n`;
      let i = 1;
      for (const title of exampleTitles) {
        prompt += `${i}. ${title}\n`;
        ++i;
      }
    }
    prompt += `\nAgain, rewrite original title. Output the following format: ~new title~ (include ~ character at the beginning and the end)\nOriginal title: ${originalTitle}`;
    const result = await this.sendMessage(prompt);
    const regex = /~([^~]+)~/g;
    return regex.exec(result)[1];
  }

  async generateAQuestionForReddit(
    exampleQuestions?: string[],
    numTries = 3
  ): Promise<string> {
    for (let i = 1; i <= numTries; i++) {
      try {
        let prompt = `Generate 5 new questions to post on r/AskReddit.`;
        let i = 1;
        if (exampleQuestions) {
          prompt += `\nExample:\n`;
          for (const exampleQuestion of exampleQuestions) {
            prompt += `${i}. ${exampleQuestion}\n`;
            ++i;
          }
        }
        const response = await this.sendMessage(prompt);

        // Choose a random question
        const regex = /\d\.\s([\w'\s,]+\?)/g;
        const matches = response.matchAll(regex);
        const questions: string[] = [];
        for (const match of matches) {
          questions.push(match[1]);
        }
        return choice(questions);
      } catch (err) {
        await logError(
          `[ChatGPT] Failed to generate a question for Reddit, ` + err
        );
      }
      await delay(5000);
    }
    throw new Error(
      `[ChatGPT] Failed to generate a question for Reddit, maximum retried`
    );
  }

  async generateACommentForRedditPost(opts: {
    postTitle: string;
    postContent?: string;
    comments?: string[];
    numTries?: number;
  }): Promise<string> {
    const { postTitle, postContent, comments, numTries = 3 } = opts;
    for (let i = 1; i <= numTries; i++) {
      try {
        let prompt =
          "You're a Reddit user. Write down 10 new comments for the following Reddit post. Then choose 1 comment that you think is likely to receive the most upvotes. Then write the comment you chose in format: Best comment: `comment content` (include ` character at the beginning and the end). Then explain why you chose that comment.\n";
        prompt += `Here's the post:\n${postTitle}`;
        if (postContent) {
          prompt += `\n${postContent}`;
        }
        if (comments) {
          prompt += "\nExample comments:\n";
          let i = 1;
          for (const comment of comments) {
            prompt += `${i}. ${comment}\n`;
            ++i;
          }
        }

        const response = await this.sendMessage(prompt);
        const regex = /Best\scomment:\s`([^`]+)`/g;
        return regex.exec(response)[1];
      } catch (err) {
        await logError(
          `[ChatGPT] Failed to generate a comment for Reddit, ` + err
        );
      }
    }
    throw new Error(
      `[ChatGPT] Failed to generate a comment for Reddit, maximum retried`
    );
  }
}
