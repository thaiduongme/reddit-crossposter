import { Schema, model, Document } from "mongoose";
import { ProxyProvider, ProxyType } from "../../../loaders/enums";
import { IProxyEntity } from "../interfaces/proxy.interface";

export const proxySchema = new Schema<IProxyEntity>({
  apiKey: {
    type: String,
    required: true,
    maxlength: 255,
    unique: true,
  },
  isRotating: {
    type: Boolean,
    required: false,
    default: false,
  },
  using: {
    type: Number,
    required: false,
    default: 0,
  },
  numUses: {
    type: Number,
    required: false,
    default: 0,
  },
  provider: {
    type: String,
    enum: ProxyProvider,
    required: true,
  },
  status: {
    type: Boolean,
    required: false,
    default: true,
  },
  lastUsed: {
    type: Date,
    required: false,
  },
  type: {
    type: String,
    enum: ProxyType,
  },
});

// Update to the latest document
proxySchema.methods.update = async function () {
  const latestProxy = await this.model("Proxy").findOne({ _id: this._id });

  for (const key of Object.keys(this)) {
    this[key] = latestProxy[key];
  }
};

export const ProxyEntity = model<IProxyEntity>("Proxy", proxySchema);
