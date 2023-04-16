import * as dotenv from "dotenv";
import { FarmStage } from "../loaders/enums";
import { FrequencyByStage } from "../modules/account/interfaces/account-db.interface";

dotenv.config({ path: ".env" });

const REQUIRED_ENV_VARS = [
  "BROWSER_DEFAULT_TIMEOUT_MS",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_KEY",
  "AWS_S3_BUCKET_NAME",
  "PROXY_MAX_USES",
  "PROXY_RETRY_TIME_OUT_MS",
  "PROXY_RETRY_POLLING_INTERVAL_MS",
  "MONGODB_HOST",
  "MONGODB_DATABASE",
  "MONGODB_USERNAME",
  "MONGODB_PASSWORD",
  "REDIS_HOST",
  "REDIS_PORT",
  "NOPECHA_API_KEY",
  "CAPTCHA_TIMEOUT_MS",
  "CAPTCHA_POLLING_INTERVAL_MS",
  "CHATGPT_BASE_API_URL",
  "CHATGPT_API_SECRET_KEY",
  "IMGUR_CLIENT_ID",
  "REDDIT_CROSSPOSTER_MINIMUM_DAYS_OLD",
  "REDDIT_CROSSPOSTER_MINIMUM_KARMA",
  "REDDIT_CROSSPOSTER_CROSSPOST_FREQUENCY",
  "REDDIT_CROSSPOSTER_SLEEP_MS",
  "NUM_ACCOUNTS_PER_CLUSTER",
];

interface Configuration {
  browser: {
    defaultTimeoutMs: number;
  };
  gologin: {
    apiKey: string;
  };
  aws: {
    accessKeyId: string;
    secretKey: string;
    s3BucketName: string;
  };
  proxy: {
    maxUses: number;
    retryTimeoutMs: number;
    retryPollingIntervalMs: number;
  };
  mongodb: {
    host: string;
    database: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
  };
  chatgpt: {
    baseApiUrl: string;
    apiSecretKey: string;
  };
  captcha: {
    nopechaApiKey: string;
    timeoutMs: number;
    pollingIntervalMs: number;
  };
  imgur: {
    clientId: string;
  };
  redditCrossposter: {
    minimumDaysOld: number;
    minimumKarma: number;
    frequency: FrequencyByStage[];
    sleepMs: number;
  };
  reddit: {
    numAccountsPerCluster: number;
  };
}

export const config: Configuration = {
  browser: {
    defaultTimeoutMs: +process.env.BROWSER_DEFAULT_TIMEOUT_MS,
  },
  gologin: {
    apiKey: process.env.GOLOGIN_API_KEY,
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_KEY,
    s3BucketName: process.env.AWS_S3_BUCKET_NAME,
  },
  proxy: {
    maxUses: +process.env.PROXY_MAX_USES,
    retryPollingIntervalMs: +process.env.PROXY_RETRY_POLLING_INTERVAL_MS,
    retryTimeoutMs: +process.env.PROXY_RETRY_TIMEOUT_MS,
  },
  mongodb: {
    host: process.env.MONGODB_HOST,
    database: process.env.MONGODB_DATABASE,
    username: process.env.MONGODB_USERNAME,
    password: process.env.MONGODB_PASSWORD,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: +process.env.REDIS_PORT,
  },
  chatgpt: {
    baseApiUrl: process.env.CHATGPT_BASE_API_URL,
    apiSecretKey: process.env.CHATGPT_API_SECRET_KEY,
  },
  captcha: {
    nopechaApiKey: process.env.NOPECHA_API_KEY,
    timeoutMs: +process.env.CAPTCHA_TIMEOUT_MS,
    pollingIntervalMs: +process.env.CAPTCHA_POLLING_INTERVAL_MS,
  },
  imgur: {
    clientId: process.env.IMGUR_CLIENT_ID,
  },
  redditCrossposter: {
    minimumDaysOld: +process.env.REDDIT_CROSSPOSTER_MINIMUM_DAYS_OLD,
    minimumKarma: +process.env.REDDIT_CROSSPOSTER_MINIMUM_KARMA,
    frequency: JSON.parse(process.env.REDDIT_CROSSPOSTER_CROSSPOST_FREQUENCY),
    sleepMs: +process.env.REDDIT_CROSSPOSTER_SLEEP_MS,
  },
  reddit: {
    numAccountsPerCluster: +process.env.NUM_ACCOUNTS_PER_CLUSTER,
  },
};

export const validateEnvironmentVars = (): void => {
  const missingRequiredEnvVars = [];
  REQUIRED_ENV_VARS.forEach((envVar) => {
    if (!process.env[envVar]) missingRequiredEnvVars.push(envVar);
  });
  if (missingRequiredEnvVars.length != 0)
    throw new Error(
      `Missing required environment variables: [${missingRequiredEnvVars}]`
    );
};
