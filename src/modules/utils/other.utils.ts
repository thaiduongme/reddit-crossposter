import fs from "fs";
import { request } from "undici";
import { LOG_PREFIX, MAX_LOG_LENGTH } from "../../loaders/constants";
import mongoose from "mongoose";
import { ClusterDB } from "../cluster/cluster.db";

export function randint(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function choice(array: any[]) {
  return array[randint(0, array.length - 1)];
}

export function randomString(length: number) {
  const CHARACTERS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARACTERS.charAt(randint(0, CHARACTERS.length - 1));
  }
  return result;
}

export function convertTxtToArray(filePath: string): string[] {
  return fs.readFileSync(filePath).toString().split("\n");
}

export function diffHours(date1: Date, date2: Date): number {
  let diff = (date1.getTime() - date2.getTime()) / 1000;
  diff /= 60 * 60;
  return Math.abs(Math.round(diff));
}

export async function isValidateLink(link: string): Promise<boolean> {
  try {
    const { statusCode } = await request(link, { method: "HEAD" });
    if (statusCode == 200) return true;
    return false;
  } catch {
    return false;
  }
}

export async function findAsync(arr: any[], asyncCallback) {
  const promises = arr.map(asyncCallback);
  const results = await Promise.all(promises);
  const index = results.findIndex((result) => result);
  return arr[index];
}

export const clusterDB = new ClusterDB();

export async function logInfo(message: string) {
  console.log(
    `${LOG_PREFIX}${
      message.length > MAX_LOG_LENGTH
        ? message.substring(0, MAX_LOG_LENGTH) + "..."
        : message
    }`
  );
  if (mongoose.connection.readyState == 1) {
    await clusterDB.updateLog(message);
  }
}

export async function logError(message: string) {
  console.error(`${LOG_PREFIX}${message}`);
  if (mongoose.connection.readyState == 1) {
    await clusterDB.updateLog(message);
  }
}

export async function getIp(): Promise<string> {
  const { body } = await request("https://api.ipify.org/?format=json");
  return (await body.json()).ip;
}
