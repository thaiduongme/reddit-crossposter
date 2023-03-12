import { IUploader } from "./interfaces/uploader.interface";
import axios from "axios";
import HttpsProxyAgent from "https-proxy-agent/dist/agent";
import { Proxy } from "../proxy/interfaces/proxy.interface";

export class ImgurUploader implements IUploader {
  constructor(
    private readonly clientID: string,
    private readonly proxy: Proxy
  ) {}

  async uploadVideoByUrl(
    url: string,
    disableAudio: boolean = false
  ): Promise<string> {
    let data = {
      video: url,
      type: "url",
      disable_audio: disableAudio ? 1 : 0,
    };
    let responseData: any;
    let wrongUrl = false;
    try {
      console.log(
        `[Cluster ${process.env.pm_id}][Uploader][Imgur] ${url} -> Uploading`
      );
      responseData = await axios.post(
        `https://api.imgur.com/3/upload`,
        new URLSearchParams(
          Object.keys(data).map((key) => [key, data[key]])
        ).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36`,
            Authorization: `Client-ID ${this.clientID}`,
          },
          httpsAgent: new HttpsProxyAgent({
            host: this.proxy.host,
            port: this.proxy.port,
            auth: `${this.proxy.username}:${this.proxy.password}`,
          }),
        }
      );
    } catch (err) {
      if (
        (err as any)?.response?.data?.status == 429 ||
        (err as any)?.response?.status == 429
      ) {
        console.error(
          `[Cluster ${process.env.pm_id}][Uploader][Imgur] ${url} -> Failed, 429: too many requests.`
        );
      }
      if (
        (err as any)?.response?.data?.status == 400 ||
        (err as any)?.response?.status == 400
      ) {
        console.log(
          `[Cluster ${process.env.pm_id}][Uploader][Imgur] ${url} -> Failed, Original URL is died.`
        );
        wrongUrl = true;
      }
    }
    if (!responseData?.data?.data?.link || wrongUrl) return null;
    console.log(
      `[Cluster ${process.env.pm_id}][Uploader][Imgur] ${url} -> New link: ${responseData.data.data.link}`
    );
    return responseData.data.data.link;
  }

  async isUploadedSuccessfully(url: string): Promise<boolean> {
    try {
      const idRegex = /\/([^\.]+)\.mp4/g;
      const id = idRegex.exec(url)[1];
      const responseData = await axios.get(
        `https://api.imgur.com/3/image/${id}`,
        {
          headers: {
            Authorization: `Client-ID ${this.clientID}`,
          },
        }
      );
      const data = responseData.data;
      if (data?.data?.processing?.status == "completed") {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
