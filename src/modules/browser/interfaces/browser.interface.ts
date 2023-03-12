import { Browser, Page } from "puppeteer";
import GoLogin from "../gologin/gologin";
import { IBrowserOptions } from "./browser-options.interface";

export interface IBrowser {
  options: IBrowserOptions;
  getBrowser(): Promise<Browser> | Browser;
  getPage(): Promise<Page>;
  close(): Promise<void>;
  getProfileId(): string;
}
