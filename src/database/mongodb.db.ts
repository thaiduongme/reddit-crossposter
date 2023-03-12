import { DBHelperBase } from "./interfaces/db.interface";
import mongoose from "mongoose";
mongoose.set("strictQuery", false);

export class MongodbHelper implements DBHelperBase {
  private connectUrl: string;
  constructor(
    public host: string,
    public database: string,
    public username: string,
    public password: string
  ) {
    this.connectUrl = `mongodb+srv://${this.username}:${this.password}@${this.host}/${this.database}?retryWrites=true&w=majority`;
  }
  async connect(): Promise<void> {
    await mongoose.connect(this.connectUrl);
  }
  disconnect(): void {
    throw new Error("Method not implemented.");
  }
}
