import { ProxyType } from "aws-sdk/clients/migrationhubrefactorspaces";
import { ProxyProvider } from "../../../loaders/enums";
import { Proxyno1RotatingProxy } from "../proxyno1.proxy";

export interface IRotatingProxy {
  getInfo(): Promise<Proxy>;
  changeIP(): Promise<void>;
}

export interface Proxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface IProxyEntity extends Document {
  apiKey: string;
  provider: ProxyProvider;
  isRotating?: boolean;
  using?: number;
  numUses?: number;
  status?: boolean;
  lastUsed?: Date;
  type: ProxyType;
}
