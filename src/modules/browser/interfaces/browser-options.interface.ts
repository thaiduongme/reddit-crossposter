import { CaptchaSolvingProvider } from "../../../loaders/enums";
import { Proxy } from "../../proxy/interfaces/proxy.interface";

export interface IBrowserOptions {
  accessToken?: string;
  profileId?: string;
  extra_params?: string[];
  proxy?: Proxy;
  captchaSolver?: CaptchaSolver;
}

export interface CaptchaSolver {
  provider: CaptchaSolvingProvider;
  apiKey: string;
}
