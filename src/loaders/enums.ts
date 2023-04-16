export enum GologinOS {
  WINDOWS = "win",
  LINUX = "lin",
  MAC = "mac",
  ANDROID = "android",
}

export enum ProxyProvider {
  ProxyNo1 = "ProxyNo1",
}

export enum ProxyType {
  RESIDENTIAL = "RESIDENTIAL",
  LTE = "4G",
}

export enum CaptchaSolvingProvider {
  NopeCHA = "NopeCHA",
}

export enum BotAction {
  READ_RANDOM_POST = "READ_RANDOM_POST",
  FARM_POST_KARMA = "FARM_POST_KARMA",
  FARM_COMMENT_KARMA = "FARM_COMMENT_KARMA",
  JOIN_SUBREDDIT = "JOIN_SUBREDDIT",
  UPVOTE_RANDOM_POST = "UPVOTE_RANDOM_POST",
  UPVOTE_RANDOM_COMMENT = "UPVOTE_RANDOM_COMMENT",
  TURN_ON_NSFW = "TURN_ON_NSFW",
  CUSTOMIZE_ABOUT_PROFILE = "CUSTOMIZE_ABOUT_PROFILE",
  POST_CONTENT = "POST_CONTENT",
  CROSS_POST = "CROSS_POST",
}

export enum SubredditUsedFor {
  CROSS_POST = "CROSS_POST",
  POST_KARMA = "POST_KARMA",
  COMMENT_KARMA = "COMMENT_KARMA",
  MULTI_PURPOSE = "MULTI_PURPOSE",
  MONETIZATION = "MONETIZATION",
}

export enum SubredditType {
  ARCHIVED = "archived",
  EMPLOYEES_ONLY = "employees_only",
  GOLD_ONLY = "gold_only",
  GOLD_RESTRICTED = "gold_restricted",
  PRIVATE = "private",
  PUBLIC = "public",
  RESTRICTED = "restricted",
}

export enum FarmStage {
  DAY_1 = "DAY_1",
  DAY_2 = "DAY_2",
  DAY_3 = "DAY_3",
  TRUST = "TRUST",
}

export enum HistoryAction {
  COMMENT = "COMMENT",
  POST = "POST",
  CROSS_POST = "CROSS_POST",
}

export enum PostType {
  LINK = "LINK",
  TEXT = "TEXT",
}

export enum SubredditPostType {
  LINK = "LINK",
  IMAGE = "IMAGE",
  VIDEO = "VIDEO",
  TEXT = "TEXT",
}

export enum PostSource {
  NSFWMonster = "NSFWMonster.io",
}

export enum BotType {
  KARMA_FARMER = "KARMA_FARMER",
  CROSS_POSTER = "CROSS_POSTER",
  CONTENT_POSTER = "CONTENT_POSTER",
  ACCOUNT_CREATOR = "ACCOUNT_CREATOR",
}
