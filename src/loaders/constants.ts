import { FarmStage } from "./enums";

export const BROWSER_EXTRA_PARAMS = [
  "--display-capture-permissions-policy-allowed",
  "--event-path-policy=0",
  "--no-sandbox",
  "--disable-background-timer-throttling",
  "--disable-breakpad",
  "--no-zygote",
  "--enable-main-frame-before-activation",
  "--disable-dev-shm-usage",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

export const REDIS_GOLOGIN_API_KEY = "gologin:api_key";

export const FARM_STAGE_ORDER = [
  FarmStage.DAY_1,
  FarmStage.DAY_2,
  FarmStage.DAY_3,
  FarmStage.TRUST,
];

export const MAX_LOG_LENGTH = 255;

export const LOG_PREFIX = process.env.pm_id
  ? `[Cluster ${process.env.pm_id}]`
  : "";
