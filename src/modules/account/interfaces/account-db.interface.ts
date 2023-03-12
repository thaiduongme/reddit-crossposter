import { HydratedDocument } from "mongoose";
import { FarmStage } from "../../../loaders/enums";
import { IAccountEntity } from "../entities/account.entity";

export interface IAccountDB {
  startUsing(): Promise<HydratedDocument<IAccountEntity>>;
  endUsing(status: boolean): Promise<void>;
}

export interface FrequencyByStage {
  stage: FarmStage;
  frequency: number;
}
