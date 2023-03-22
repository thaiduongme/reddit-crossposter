import { exec as execNonPromise, execFile, spawn } from "child_process";
import debug from "debug";
import decompress from "decompress";
import decompressUnzip from "decompress-unzip";
import { existsSync, mkdirSync, promises as _promises } from "fs";
import { get as _get } from "https";
import { tmpdir } from "os";
import { join, resolve as _resolve, sep } from "path";
import requests from "requestretry";
import rimraf from "rimraf";
import ProxyAgent from "simple-proxy-agent";
import util from "util";
import * as path from "node:path";
import cluster from "node:cluster";

import { fontsCollection } from "./fonts.js";
import {
  updateProfileProxy,
  updateProfileResolution,
  updateProfileUserAgent,
} from "./browser/browser-api.js";
import BrowserChecker from "./browser/browser-checker.js";
import {
  composeFonts,
  downloadCookies,
  setExtPathsAndRemoveDeleted,
  setOriginalExtPaths,
  uploadCookies,
} from "./browser/browser-user-data-manager.js";
import {
  getChunckedInsertValues,
  getDB,
  loadCookiesFromFile,
} from "./cookies/cookies-manager.js";
import ExtensionsManager from "./extensions/extensions-manager.js";
import { archiveProfile } from "./profile/profile-archiver.js";
import { API_URL } from "./utils/common.js";
import { get, isPortReachable } from "./utils/utils.js";
const AWS = require("aws-sdk");
const { config } = require("../../../config/configuration");
import { kill } from "cross-port-killer";

const exec = util.promisify(execNonPromise);

const { access, unlink, writeFile, readFile } = _promises;

const SEPARATOR = sep;
const OS_PLATFORM = process.platform;

// process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

export class GoLogin {
  constructor(options = {}) {
    this.is_remote = options.remote || false;
    this.access_token = options.token;
    this.profile_id = options.profile_id;
    this.password = options.password;
    this.extra_params = options.extra_params;
    this.executablePath = options.executablePath;
    this.vnc_port = options.vncPort;
    this.fontsMasking = false;
    this.is_active = false;
    this.is_stopping = false;
    this.differentOs = false;
    this.profileOs = "lin";
    this.waitWebsocket = true;
    if (options.waitWebsocket === false) {
      this.waitWebsocket = false;
    }

    this.tmpdir = tmpdir();
    this.autoUpdateBrowser = !!options.autoUpdateBrowser;
    this.browserChecker = new BrowserChecker(options.skipOrbitaHashChecking);
    this.uploadCookiesToServer = options.uploadCookiesToServer || false;
    this.writeCookesFromServer = options.writeCookesFromServer;
    this.remote_debugging_port = options.remote_debugging_port || 0;
    this.timezone = options.timezone;
    this.extensionPathsToInstall = [];
    this.restoreLastSession = options.restoreLastSession || false;
    this.s3 = new AWS.S3({
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretKey,
    });

    if (options.tmpdir) {
      this.tmpdir = options.tmpdir;
      if (!existsSync(this.tmpdir)) {
        debug("making tmpdir", this.tmpdir);
        mkdirSync(this.tmpdir, { recursive: true });
      }
    }

    this.cookiesFilePath = join(
      this.tmpdir,
      `gologin_profile_${this.profile_id}`,
      "Default",
      "Network",
      "Cookies"
    );
    this.profile_zip_path = join(this.tmpdir, `gologin_${this.profile_id}.zip`);
    debug("INIT GOLOGIN", this.profile_id);
  }

  async checkBrowser() {
    return this.browserChecker.checkBrowser(this.autoUpdateBrowser);
  }

  async setProfileId(profile_id) {
    this.profile_id = profile_id;
    this.cookiesFilePath = join(
      this.tmpdir,
      `gologin_profile_${this.profile_id}`,
      "Default",
      "Network",
      "Cookies"
    );
    this.profile_zip_path = join(this.tmpdir, `gologin_${this.profile_id}.zip`);
  }

  async getToken(username, password) {
    const data = await requests.post(`${API_URL}/user/login`, {
      json: {
        username,
        password,
      },
    });

    if (!Reflect.has(data, "body.access_token")) {
      throw new Error(
        `gologin auth failed with status code, ${
          data.statusCode
        } DATA  ${JSON.stringify(data)}`
      );
    }
  }

  async getNewFingerPrint(os) {
    debug("GETTING FINGERPRINT");

    const fpResponse = await requests.get(
      `${API_URL}/browser/fingerprint?os=${os}`,
      {
        json: true,
        headers: {
          Authorization: `Bearer ${this.access_token}`,
          "User-Agent": "gologin-api",
        },
      }
    );

    return fpResponse?.body || {};
  }

  async profiles() {
    const profilesResponse = await requests.get(`${API_URL}/browser/v2`, {
      headers: {
        Authorization: `Bearer ${this.access_token}`,
        "User-Agent": "gologin-api",
      },
    });

    if (profilesResponse.statusCode !== 200) {
      throw new Error("Gologin /browser response error");
    }

    return JSON.parse(profilesResponse.body);
  }

  async getProfile(profile_id) {
    const id = profile_id || this.profile_id;
    debug("getProfile", this.access_token, id);

    const s3ProfileJson = await this.getS3ProfileJson(id);

    if (s3ProfileJson) {
      return s3ProfileJson;
    } else {
      const profileResponse = await requests.get(`${API_URL}/browser/${id}`, {
        headers: {
          Authorization: `Bearer ${this.access_token}`,
        },
      });
      if (profileResponse.statusCode !== 200) {
        throw new Error(
          `Gologin /browser/${id} response error ${profileResponse.statusCode} INVALID TOKEN OR PROFILE NOT FOUND`
        );
      }
      await this.uploadS3ProfileJson(id, Buffer.from(profileResponse.body));
      return JSON.parse(profileResponse.body);
    }
  }

  async emptyProfile() {
    const gologinZeroProfileB64Path = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "third-party",
      "gologin",
      "gologin_zeroprofile.b64"
    );
    return readFile(gologinZeroProfileB64Path).then((res) => res.toString());
    // return readFile(_resolve(__dirname, "gologin_zeroprofile.b64")).then(
    //   (res) => res.toString()
    // );
  }

  async getS3ProfileFolder(profileId) {
    return new Promise((resolve, reject) => {
      const downloadParams = {
        Bucket: config.aws.s3BucketName,
        Key: `${profileId}.zip`,
      };

      this.s3.getObject(downloadParams, (err, data) => {
        if (err) {
          resolve("");
        } else {
          resolve(Buffer.from(data.Body));
        }
      });
    });
  }

  async uploadS3ProfileFolder(profileId, fileBuff) {
    const uploadFileParams = {
      Bucket: config.aws.s3BucketName,
      Key: `${profileId}.zip`,
      Body: fileBuff,
    };

    try {
      await this.s3.upload(uploadFileParams).promise();
      console.log(
        `[Cluster ${process.env.pm_id}][S3][${this.profile_id}] Uploaded ${(
          fileBuff.length /
          10 ** 6
        ).toFixed(2)}MB profile folder successfully!`
      );
    } catch (err) {
      if (err instanceof Error)
        console.error(
          `[Cluster ${process.env.pm_id}][S3][${this.profile_id}] Failed to upload profile folder, ${err.message}`
        );
    }
  }

  async uploadS3ProfileJson(profileId, fileBuff) {
    const uploadFileParams = {
      Bucket: config.aws.s3BucketName,
      Key: `${profileId}.json`,
      Body: fileBuff,
    };

    try {
      await this.s3.upload(uploadFileParams).promise();
      console.log(
        `[Cluster ${process.env.pm_id}][S3][${this.profile_id}] Uploaded profile json successfully!`
      );
    } catch (err) {
      if (err instanceof Error)
        console.error(
          `[Cluster ${process.env.pm_id}][S3][${this.profile_id}] Failed to upload profile json, ${err.message}`
        );
    }
  }

  async getS3ProfileJson(profileId) {
    return new Promise((resolve, reject) => {
      const downloadParams = {
        Bucket: config.aws.s3BucketName,
        Key: `${profileId}.json`,
      };

      this.s3.getObject(downloadParams, (err, data) => {
        if (err) {
          resolve("");
        } else {
          resolve(JSON.parse(data.Body.toString("utf-8")));
        }
      });
    });
  }

  async emptyProfileFolder() {
    debug("get emptyProfileFolder");
    const zeroProfilePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "third-party",
      "gologin",
      "zero_profile.zip"
    );
    const profile = await readFile(zeroProfilePath);
    // const profile = await readFile(_resolve(__dirname, "zero_profile.zip"));
    debug("emptyProfileFolder LENGTH ::", profile.length);

    return profile;
  }

  convertPreferences(preferences) {
    if (get(preferences, "navigator.userAgent")) {
      preferences.userAgent = get(preferences, "navigator.userAgent");
    }

    if (get(preferences, "navigator.doNotTrack")) {
      preferences.doNotTrack = get(preferences, "navigator.doNotTrack");
    }

    if (get(preferences, "navigator.hardwareConcurrency")) {
      preferences.hardwareConcurrency = get(
        preferences,
        "navigator.hardwareConcurrency"
      );
    }

    if (get(preferences, "navigator.language")) {
      preferences.language = get(preferences, "navigator.language");
    }

    if (get(preferences, "navigator.maxTouchPoints")) {
      preferences.navigator.max_touch_points = get(
        preferences,
        "navigator.maxTouchPoints"
      );
    }

    if (get(preferences, "isM1")) {
      preferences.is_m1 = get(preferences, "isM1");
    }

    if (get(preferences, "os") == "android") {
      const devicePixelRatio = get(preferences, "devicePixelRatio");
      const deviceScaleFactorCeil = Math.ceil(devicePixelRatio || 3.5);
      let deviceScaleFactor = devicePixelRatio;
      if (deviceScaleFactorCeil === devicePixelRatio) {
        deviceScaleFactor += 0.00000001;
      }

      preferences.mobile = {
        enable: true,
        width: parseInt(this.resolution.width, 10),
        height: parseInt(this.resolution.height, 10),
        device_scale_factor: deviceScaleFactor,
      };
    }

    // preferences.mediaDevices = {
    //   enable: preferences.mediaDevices.enableMasking,
    //   videoInputs: preferences.mediaDevices.videoInputs,
    //   audioInputs: preferences.mediaDevices.audioInputs,
    //   audioOutputs: preferences.mediaDevices.audioOutputs,
    // };

    return preferences;
  }

  async createBrowserExtension() {
    const that = this;
    debug("start createBrowserExtension");
    await rimraf(this.orbitaExtensionPath(), () => null);
    const extPath = this.orbitaExtensionPath();
    debug("extension folder sanitized");
    const gologinExtPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "third-party",
      "gologin",
      "gologin-browser-ext.zip"
    );
    const extension_source = gologinExtPath;
    // const extension_source = _resolve(__dirname, "gologin-browser-ext.zip");
    await decompress(extension_source, extPath, {
      plugins: [decompressUnzip()],
      filter: (file) => !file.path.endsWith("/"),
    })
      .then(() => {
        debug("extraction done");
        debug("create uid.json");

        return writeFile(
          join(extPath, "uid.json"),
          JSON.stringify({ uid: that.profile_id }, null, 2)
        ).then(() => extPath);
      })
      .catch(async (e) => {
        debug("orbita extension error", e);
      });

    debug("createBrowserExtension done");
  }

  extractProfile(path, zipfile) {
    debug(`extactProfile ${zipfile}, ${path}`);

    return decompress(zipfile, path, {
      plugins: [decompressUnzip()],
      filter: (file) => !file.path.endsWith("/"),
    });
  }

  async createStartup(local = false) {
    const profilePath = join(this.tmpdir, `gologin_profile_${this.profile_id}`);
    let profile;
    let profile_folder;
    await rimraf(profilePath, () => null); // Delete profile path if exists
    debug("-", profilePath, "dropped");
    profile = await this.getProfile(); // Get profile json from API
    const { navigator = {}, fonts, os: profileOs } = profile;
    this.fontsMasking = fonts?.enableMasking;
    this.profileOs = profileOs;
    this.differentOs =
      profileOs !== "android" &&
      ((OS_PLATFORM === "win32" && profileOs !== "win") ||
        (OS_PLATFORM === "darwin" && profileOs !== "mac") ||
        (OS_PLATFORM === "linux" && profileOs !== "lin"));

    const { resolution = "1920x1080", language = "en-US,en;q=0.9" } = navigator;

    this.language = language;
    const [screenWidth, screenHeight] = resolution.split("x");
    this.resolution = {
      width: parseInt(screenWidth, 10),
      height: parseInt(screenHeight, 10),
    };

    const profileZipExists = await access(this.profile_zip_path)
      .then(() => true)
      .catch(() => false);
    if (!(local && profileZipExists)) {
      try {
        profile_folder = await this.getS3ProfileFolder(this.profile_id);
        if (profile_folder)
          console.log(
            `[Cluster ${process.env.pm_id}][S3] Found profile ${this.profile_id}`
          );
      } catch (e) {
        debug("Cannot get profile - using empty", e);
      }

      debug("FILE READY", this.profile_zip_path);
      if (!profile_folder.length) {
        profile_folder = await this.emptyProfileFolder();
      }

      await writeFile(this.profile_zip_path, profile_folder);

      debug("PROFILE LENGTH", profile_folder.length);
    } else {
      debug("PROFILE LOCAL HAVING", this.profile_zip_path);
    }

    debug("Cleaning up..", profilePath);

    try {
      await this.extractProfile(profilePath, this.profile_zip_path);
      debug("extraction done");
    } catch (e) {
      console.trace(e);
      profile_folder = await this.emptyProfileFolder();
      await writeFile(this.profile_zip_path, profile_folder);
      await this.extractProfile(profilePath, this.profile_zip_path);
    }

    const singletonLockPath = join(profilePath, "SingletonLock");
    const singletonLockExists = await access(singletonLockPath)
      .then(() => true)
      .catch(() => false);
    if (singletonLockExists) {
      debug("removing SingletonLock");
      await unlink(singletonLockPath);
      debug("SingletonLock removed");
    }

    const pref_file_name = join(profilePath, "Default", "Preferences");
    debug("reading", pref_file_name);

    const prefFileExists = await access(pref_file_name)
      .then(() => true)
      .catch(() => false);
    if (!prefFileExists) {
      debug(
        "Preferences file not exists waiting",
        pref_file_name,
        ". Using empty profile"
      );
      profile_folder = await this.emptyProfileFolder();
      await writeFile(this.profile_zip_path, profile_folder);
      await this.extractProfile(profilePath, this.profile_zip_path);
    }

    const preferences_raw = await readFile(pref_file_name);
    const preferences = JSON.parse(preferences_raw.toString());
    let proxy = get(profile, "proxy");
    const name = get(profile, "name");
    const chromeExtensions = get(profile, "chromeExtensions") || [];
    const userChromeExtensions = get(profile, "userChromeExtensions") || [];
    const allExtensions = [...chromeExtensions, ...userChromeExtensions];

    if (allExtensions.length) {
      const ExtensionsManagerInst = new ExtensionsManager();
      ExtensionsManagerInst.apiUrl = API_URL;
      await ExtensionsManagerInst.init()
        .then(() => ExtensionsManagerInst.updateExtensions())
        .catch(() => {});
      ExtensionsManagerInst.accessToken = this.access_token;

      await ExtensionsManagerInst.getExtensionsPolicies();
      let profileExtensionsCheckRes = [];

      if (ExtensionsManagerInst.useLocalExtStorage) {
        const promises = [
          ExtensionsManagerInst.checkChromeExtensions(allExtensions)
            .then((res) => ({ profileExtensionsCheckRes: res }))
            .catch((e) => {
              console.error("checkChromeExtensions error: ", e);

              return { profileExtensionsCheckRes: [] };
            }),
          ExtensionsManagerInst.checkLocalUserChromeExtensions(
            userChromeExtensions,
            this.profile_id
          )
            .then((res) => ({ profileUserExtensionsCheckRes: res }))
            .catch((error) => {
              console.error("checkUserChromeExtensions error: ", error);

              return null;
            }),
        ];

        const extensionsResult = await Promise.all(promises);

        const profileExtensionPathRes =
          extensionsResult.find((el) => "profileExtensionsCheckRes" in el) ||
          {};
        const profileUserExtensionPathRes = extensionsResult.find(
          (el) => "profileUserExtensionsCheckRes" in el
        );
        profileExtensionsCheckRes = (
          profileExtensionPathRes?.profileExtensionsCheckRes || []
        ).concat(
          profileUserExtensionPathRes?.profileUserExtensionsCheckRes || []
        );
      }

      let extSettings;
      if (ExtensionsManagerInst.useLocalExtStorage) {
        extSettings = await setExtPathsAndRemoveDeleted(
          preferences,
          profileExtensionsCheckRes,
          this.profile_id
        );
      } else {
        const originalExtensionsFolder = join(
          profilePath,
          "Default",
          "Extensions"
        );
        extSettings = await setOriginalExtPaths(
          preferences,
          originalExtensionsFolder
        );
      }

      this.extensionPathsToInstall =
        ExtensionsManagerInst.getExtensionsToInstall(
          extSettings,
          profileExtensionsCheckRes
        );

      if (extSettings) {
        const currentExtSettings = preferences.extensions || {};
        currentExtSettings.settings = extSettings;
        preferences.extensions = currentExtSettings;
      }
    }

    if (proxy.mode === "gologin" || proxy.mode === "tor") {
      const autoProxyServer = get(profile, "autoProxyServer");
      const splittedAutoProxyServer = autoProxyServer.split("://");
      const splittedProxyAddress = splittedAutoProxyServer[1].split(":");
      const port = splittedProxyAddress[1];

      proxy = {
        mode: splittedAutoProxyServer[0],
        host: splittedProxyAddress[0],
        port,
        username: get(profile, "autoProxyUsername"),
        password: get(profile, "autoProxyPassword"),
      };

      profile.proxy.username = get(profile, "autoProxyUsername");
      profile.proxy.password = get(profile, "autoProxyPassword");
    }
    // console.log('proxy=', proxy);

    if (proxy.mode === "geolocation") {
      proxy.mode = "http";
    }

    if (proxy.mode === "none") {
      proxy = null;
    }

    this.proxy = proxy;

    await this.getTimeZone(proxy).catch((e) => {
      console.error("Proxy Error. Check it and try again.");
      throw e;
    });

    const [latitude, longitude] = this._tz.ll;
    const { accuracy } = this._tz;

    const profileGeolocation = profile.geolocation;
    const tzGeoLocation = {
      latitude,
      longitude,
      accuracy,
    };

    profile.geoLocation = this.getGeolocationParams(
      profileGeolocation,
      tzGeoLocation
    );
    profile.name = name;
    profile.name_base64 = Buffer.from(name).toString("base64");
    profile.profile_id = this.profile_id;

    profile.webRtc = {
      mode:
        get(profile, "webRTC.mode") === "alerted"
          ? "public"
          : get(profile, "webRTC.mode"),
      publicIP: get(profile, "webRTC.fillBasedOnIp")
        ? this._tz.ip
        : get(profile, "webRTC.publicIp"),
      localIps: get(profile, "webRTC.localIps", []),
    };
    debug("profile.webRtc=", profile.webRtc);
    debug("profile.timezone=", profile.timezone);
    debug("profile.mediaDevices=", profile.mediaDevices);

    const audioContext = profile.audioContext || {};
    const { mode: audioCtxMode = "off", noise: audioCtxNoise } = audioContext;
    if (profile.timezone.fillBasedOnIp == false) {
      profile.timezone = { id: profile.timezone.timezone };
    } else {
      profile.timezone = { id: this._tz.timezone };
    }

    profile.webgl_noise_value = profile.webGL.noise;
    profile.get_client_rects_noise = profile.webGL.getClientRectsNoise;
    profile.canvasMode = profile.canvas.mode;
    profile.canvasNoise = profile.canvas.noise;
    profile.audioContext = {
      enable: audioCtxMode !== "off",
      noiseValue: audioCtxNoise,
    };
    profile.webgl = {
      metadata: {
        vendor: get(profile, "webGLMetadata.vendor"),
        renderer: get(profile, "webGLMetadata.renderer"),
        mode: get(profile, "webGLMetadata.mode") === "mask",
      },
    };

    profile.custom_fonts = {
      enable: !!fonts?.enableMasking,
    };

    const gologin = this.convertPreferences(profile);

    debug(
      `Writing profile for screenWidth ${profilePath}`,
      JSON.stringify(gologin)
    );
    gologin.screenWidth = this.resolution.width;
    gologin.screenHeight = this.resolution.height;
    debug("writeCookesFromServer", this.writeCookesFromServer);
    if (this.writeCookesFromServer) {
      await this.writeCookiesToFile();
    }

    if (this.fontsMasking) {
      const families = fonts?.families || [];
      if (!families.length) {
        throw new Error("No fonts list provided");
      }

      try {
        await composeFonts(families, profilePath, this.differentOs);
      } catch (e) {
        console.trace(e);
      }
    }

    const [languages] = this.language.split(";");

    if (preferences.gologin == null) {
      preferences.gologin = {};
    }

    // FIXED: Add more gologin properties to gologin
    gologin.langHeader = gologin.language;
    gologin.languages = languages;
    gologin.client_rects_noise_enable =
      profile.clientRects == "on" ? true : false;
    gologin.deviceMemory = profile.navigator.deviceMemory * 1024;
    gologin.doNotTrack = profile.navigator.doNotTrack ? true : false;
    gologin.getClientRectsNoice = profile.clientRects.noise;
    gologin.get_client_rects_noise = profile.clientRects.noise;
    gologin.is_m1 = false;
    gologin.mediaDevices = {
      enable: profile.mediaDevices.enableMasking,
      videoInputs: profile.mediaDevices.videoInputs,
      audioInputs: profile.mediaDevices.audioInputs,
      audioOutputs: profile.mediaDevices.audioOutputs,
      uid: profile.mediaDevices.uid,
    };
    gologin.navigator.max_touch_points = 0;
    const devicePixelRatio = profile.devicePixelRatio;
    const deviceScaleFactorCeil = Math.ceil(devicePixelRatio || 3.5);
    let deviceScaleFactor = devicePixelRatio;
    if (deviceScaleFactorCeil === devicePixelRatio) {
      deviceScaleFactor += 0.00000001;
    }

    gologin.mobile = {
      enable: false,
      width: parseInt(this.resolution.width, 10),
      height: parseInt(this.resolution.height, 10),
      device_scale_factor: deviceScaleFactor,
    };
    gologin.plugins = {
      all_enable: true,
      flash_enable: true,
    };
    (gologin.startupUrl = "https://iphey.com"), (gologin.startup_urls = [" "]);
    gologin.storage = {
      enable: true,
    };
    gologin.unpinable_extension_names = ["passwords-ext"];
    gologin.webGl = {
      mode: true,
      renderer: profile.webGLMetadata.renderer,
      vendor: profile.webGLMetadata.vendor,
    };
    gologin.webRtc = {
      fill_based_on_ip: true,
      localIps: "",
      local_ip_masking: true,
      mode: "public",
      public_ip: this._tz.ip,
    };
    gologin.webglNoiceEnable = false;
    gologin.webglNoiseValue = profile.webGL.noise;
    gologin.webgl_noice_enable = false;
    gologin.webgl_noise_enable = false;

    // Delete property
    delete gologin.autoProxyPassword;
    delete gologin.autoProxyServer;
    delete gologin.autoProxyUsername;
    delete gologin.browserType;
    delete gologin.canBeRunning;
    delete gologin.canvas;
    delete gologin.checkCookies;
    delete gologin.chromeExtensions;
    delete gologin.checkCookies;
    delete gologin.clientRects;
    delete gologin.custom_fonts;
    delete gologin.debugMode;
    delete gologin.devicePixelRatio;
    delete gologin.debugMode;
    delete gologin.extensions;
    delete gologin.fonts;
    delete gologin.geolocation;
    delete gologin.geoLocation.customize;
    delete gologin.geoLocation.enabled;
    delete gologin.geoLocation.fillBasedOnIp;
    delete gologin.googleServicesEnabled;
    delete gologin.id;
    delete gologin.language;
    delete gologin.lockEnabled;
    delete gologin.name_base64;
    delete gologin.navigator.deviceMemory;
    delete gologin.navigator.doNotTrack;
    delete gologin.navigator.hardwareConcurrency;
    delete gologin.navigator.language;
    delete gologin.navigator.maxTouchPoints;
    delete gologin.navigator.resolution;
    delete gologin.navigator.userAgent;
    delete gologin.navigator.notes;
    delete gologin.os;
    delete gologin.owner;
    delete gologin.proxyEnabled;
    delete gologin.s3Date;
    delete gologin.s3Path;
    delete gologin.startUrl;
    delete gologin.userChromeExtensions;
    delete gologin.webGL;
    delete gologin.webGLMetadata;
    delete gologin.webRTC;

    // debug("convertedPreferences=", preferences.gologin)
    await writeFile(
      join(profilePath, "Default", "Preferences"),
      JSON.stringify(
        Object.assign(preferences, {
          gologin,
        })
      )
    );

    debug(
      "Profile ready. Path: ",
      profilePath,
      "PROXY",
      JSON.stringify(get(preferences, "gologin.proxy"))
    );

    return profilePath;
  }

  async commitProfile() {
    const dataBuff = await this.getProfileDataToUpdate();

    debug("begin updating", dataBuff.length);
    if (!dataBuff.length) {
      debug("WARN: profile zip data empty - SKIPPING PROFILE COMMIT");

      return;
    }

    try {
      debug("Patching profile");
      await this.uploadS3ProfileFolder(this.profile_id, dataBuff);
    } catch (e) {
      debug("CANNOT COMMIT PROFILE", e);
    }

    debug("COMMIT COMPLETED");
  }

  profilePath() {
    return join(this.tmpdir, `gologin_profile_${this.profile_id}`);
  }

  orbitaExtensionPath() {
    return join(this.tmpdir, `orbita_extension_${this.profile_id}`);
  }

  getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);

    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async checkPortAvailable(port) {
    debug("CHECKING PORT AVAILABLE", port);
    try {
      // const { stdout, stderr } = await exec(`lsof -i:${port}`);
      // if (stdout && stdout.match(/LISTEN/gim)) {
      //   debug(`PORT ${port} IS BUSY`);

      //   return false;
      // }
      const portAvailable = await isPortReachable(port, { host: "localhost" });
      if (portAvailable) {
        return true;
      }
    } catch (e) {
      console.err(`[GOLOGIN][Check Port] ${e}`);
    }

    debug(`PORT ${port} IS OPEN`);

    return false;
  }

  async getRandomPort() {
    let port = this.getRandomInt(20000, 40000);
    let portAvailable = this.checkPortAvailable(port);
    while (!portAvailable) {
      port = this.getRandomInt(20000, 40000);
      portAvailable = await this.checkPortAvailable(port);
    }

    return port;
  }

  async getTimeZone(proxy) {
    debug("getting timeZone proxy=", proxy);

    if (this.timezone) {
      debug("getTimeZone from options", this.timezone);
      this._tz = this.timezone;

      return this._tz.timezone;
    }

    let data = null;
    if (proxy !== null && proxy.mode !== "none") {
      if (proxy.mode.includes("socks")) {
        for (let i = 0; i < 5; i++) {
          try {
            debug("getting timeZone socks try", i + 1);

            return this.getTimezoneWithSocks(proxy);
          } catch (e) {
            console.log(e.message);
          }
        }
        throw new Error("Socks proxy connection timed out");
      }

      const proxyUrl = `${proxy.mode}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
      debug("getTimeZone start https://time.gologin.com/timezone", proxyUrl);
      data = await requests.get("https://time.gologin.com/timezone", {
        proxy: proxyUrl,
        timeout: 20 * 1000,
        maxAttempts: 5,
      });
    } else {
      data = await requests.get("https://time.gologin.com/timezone", {
        timeout: 20 * 1000,
        maxAttempts: 5,
      });
    }

    debug("getTimeZone finish", data.body);
    this._tz = JSON.parse(data.body);

    return this._tz.timezone;
  }

  async getTimezoneWithSocks(params) {
    const { mode = "http", host, port, username = "", password = "" } = params;
    let body;

    let proxy = mode + "://";
    if (username) {
      const resultPassword = password ? ":" + password + "@" : "@";
      proxy += username + resultPassword;
    }

    proxy += host + ":" + port;

    const agent = new ProxyAgent(proxy, { tunnel: true, timeout: 10000 });

    const checkData = await new Promise((resolve, reject) => {
      _get("https://time.gologin.com/timezone", { agent }, (res) => {
        let resultResponse = "";
        res.on("data", (data) => (resultResponse += data));

        res.on("end", () => {
          let parsedData;
          try {
            parsedData = JSON.parse(resultResponse);
          } catch (e) {
            reject(e);
          }

          resolve({
            ...res,
            body: parsedData,
          });
        });
      }).on("error", (err) => reject(err));
    });

    // console.log('checkData:', checkData);
    body = checkData.body || {};
    if (!body.ip && checkData.statusCode.toString().startsWith("4")) {
      throw checkData;
    }

    debug("getTimeZone finish", body.body);
    this._tz = body;

    return this._tz.timezone;
  }

  async spawnArguments() {
    const profile_path = this.profilePath();

    let { proxy } = this;
    proxy = `${proxy.mode}://${proxy.host}:${proxy.port}`;

    const env = {};
    Object.keys(process.env).forEach((key) => {
      env[key] = process.env[key];
    });
    const tz = await this.getTimeZone(this.proxy).catch((e) => {
      console.error("Proxy Error. Check it and try again.");
      throw e;
    });

    env.TZ = tz;

    let params = [
      `--proxy-server=${proxy}`,
      `--user-data-dir=${profile_path}`,
      "--password-store=basic",
      `--tz=${tz}`,
      "--lang=en",
    ];
    if (Array.isArray(this.extra_params) && this.extra_params.length) {
      params = params.concat(this.extra_params);
    }

    if (this.remote_debugging_port) {
      params.push(`--remote-debugging-port=${this.remote_debugging_port}`);
    }

    return params;
  }

  async spawnBrowser() {
    let { remote_debugging_port } = this;
    if (!remote_debugging_port) {
      remote_debugging_port = await this.getRandomPort();
    }

    const profile_path = this.profilePath();

    let { proxy } = this;
    let proxy_host = "";
    if (proxy) {
      proxy_host = this.proxy.host;
      proxy = `${proxy.mode}://${proxy.host}:${proxy.port}`;
    }

    this.port = remote_debugging_port;

    const ORBITA_BROWSER =
      this.executablePath || this.browserChecker.getOrbitaPath;
    debug(`ORBITA_BROWSER=${ORBITA_BROWSER}`);
    const env = {};
    Object.keys(process.env).forEach((key) => {
      env[key] = process.env[key];
    });
    const tz = await this.getTimeZone(this.proxy).catch((e) => {
      console.error("Proxy Error. Check it and try again.");
      throw e;
    });

    env.TZ = tz;

    if (this.vnc_port) {
      const script_path = _resolve(__dirname, "./run.sh");
      debug(
        "RUNNING",
        script_path,
        ORBITA_BROWSER,
        remote_debugging_port,
        proxy,
        profile_path,
        this.vnc_port
      );
      execFile(
        script_path,
        [
          ORBITA_BROWSER,
          remote_debugging_port,
          proxy,
          profile_path,
          this.vnc_port,
          tz,
        ],
        { env }
      );
    } else {
      const [splittedLangs] = this.language.split(";");
      let [browserLang] = splittedLangs.split(",");
      if (process.platform === "darwin") {
        browserLang = "en-US";
      }

      let params = [
        `--remote-debugging-port=${remote_debugging_port}`,
        `--user-data-dir=${profile_path}`,
        "--password-store=basic",
        `--tz=${tz}`,
        `--lang=${browserLang}`,
      ];

      if (this.extensionPathsToInstall.length) {
        if (Array.isArray(this.extra_params) && this.extra_params.length) {
          this.extra_params.forEach((param, index) => {
            if (!param.includes("--load-extension=")) {
              return;
            }

            const [_, extPathsString] = param.split("=");
            const extPathsArray = extPathsString.split(",");
            this.extensionPathsToInstall = [
              ...this.extensionPathsToInstall,
              ...extPathsArray,
            ];
            this.extra_params.splice(index, 1);
          });
        }

        params.push(
          `--load-extension=${this.extensionPathsToInstall.join(",")}`
        );
      }

      if (this.fontsMasking) {
        let arg = "--font-masking-mode=2";
        if (this.differentOs) {
          arg = "--font-masking-mode=3";
        }

        if (this.profileOs === "android") {
          arg = "--font-masking-mode=1";
        }

        params.push(arg);
      }

      if (proxy) {
        const hr_rules = `"MAP * 0.0.0.0 , EXCLUDE ${proxy_host}"`;
        params.push(`--proxy-server=${proxy}`);
        params.push(`--host-resolver-rules=${hr_rules}`);
      }

      if (Array.isArray(this.extra_params) && this.extra_params.length) {
        params = params.concat(this.extra_params);
      }

      if (this.restoreLastSession) {
        params.push("--restore-last-session");
      }

      const child = execFile(ORBITA_BROWSER, params, { env });
      // const child = spawn(ORBITA_BROWSER, params, { env, shell: true });
      child.stdout.on("data", (data) => debug(data.toString()));
      debug("SPAWN CMD", ORBITA_BROWSER, params.join(" "));
    }

    if (this.waitWebsocket) {
      debug("GETTING WS URL FROM BROWSER");
      const data = await requests.get(
        `http://127.0.0.1:${remote_debugging_port}/json/version`,
        { json: true }
      );

      debug("WS IS", get(data, "body.webSocketDebuggerUrl", ""));
      this.is_active = true;

      return get(data, "body.webSocketDebuggerUrl", "");
    }

    return "";
  }

  async createStartupAndSpawnBrowser() {
    await this.createStartup();
    return this.spawnBrowser();
  }

  async clearProfileFiles() {
    await rimraf(
      join(this.tmpdir, `gologin_profile_${this.profile_id}`),
      () => null
    );
    await rimraf(
      join(this.tmpdir, `gologin_${this.profile_id}_upload.zip`),
      () => null
    );
  }

  async stopAndCommit(options, local = false) {
    if (this.is_stopping) {
      return true;
    }

    const is_posting =
      options.posting ||
      options.postings || // backward compability
      false;

    if (this.uploadCookiesToServer) {
      await this.uploadProfileCookiesToServer();
    }

    this.is_stopping = true;
    await this.sanitizeProfile();

    if (is_posting) {
      await this.commitProfile();
    }

    this.is_stopping = false;
    this.is_active = false;
    await delay(3000);
    await this.clearProfileFiles();

    if (!local) {
      await rimraf(
        join(this.tmpdir, `gologin_${this.profile_id}.zip`),
        () => null
      );
    }

    debug(`PROFILE ${this.profile_id} STOPPED AND CLEAR`);

    return false;
  }

  async stopBrowser() {
    if (!this.port) {
      throw new Error("Empty GoLogin port");
    }
    await kill(this.port);
    // return new Promise((resolve, reject) => {
    //   const command = `fuser -k TERM -n tcp ${this.port}`;
    //   const ls = spawn(command, {
    //     shell: true,
    //   });

    //   ls.stdout.on("data", (data) => {
    //     console.log(
    //       `[Cluster ${process.env.pm_id}][Close Browser] stdout: ${data}`
    //     );
    //   });

    //   ls.stderr.on("data", (data) => {
    //     console.error(
    //       `[Cluster ${process.env.pm_id}][Close Browser] stderr: ${data}`
    //     );
    //   });

    //   ls.on("close", (code) => {
    //     if (code === 0) {
    //       resolve();
    //     } else {
    //       reject(
    //         new Error(
    //           `[Cluster ${process.env.pm_id}][Close Browser] Command failed with exit code ${code}`
    //         )
    //       );
    //     }
    //   });

    //   ls.on("error", (err) => {
    //     reject("[Cluster ${process.env.pm_id}][Close Browser] " + err);
    //   });
    // });
  }

  async sanitizeProfile() {
    const remove_dirs = [
      `${SEPARATOR}Default${SEPARATOR}Cache`,
      `${SEPARATOR}Default${SEPARATOR}Service Worker${SEPARATOR}CacheStorage`,
      `${SEPARATOR}Default${SEPARATOR}Code Cache`,
      `${SEPARATOR}Default${SEPARATOR}GPUCache`,
      `${SEPARATOR}GrShaderCache`,
      `${SEPARATOR}ShaderCache`,
      `${SEPARATOR}biahpgbdmdkfgndcmfiipgcebobojjkp`,
      `${SEPARATOR}afalakplffnnnlkncjhbmahjfjhmlkal`,
      `${SEPARATOR}cffkpbalmllkdoenhmdmpbkajipdjfam`,
      `${SEPARATOR}Dictionaries`,
      `${SEPARATOR}enkheaiicpeffbfgjiklngbpkilnbkoi`,
      `${SEPARATOR}oofiananboodjbbmdelgdommihjbkfag`,
      `${SEPARATOR}SafetyTips`,
      `${SEPARATOR}fonts`,
      `${SEPARATOR}BrowserMetrics`,
      `${SEPARATOR}BrowserMetrics-spare.pma`,
    ];

    const that = this;

    await Promise.all(
      remove_dirs.map((d) => {
        const path_to_remove = `${that.profilePath()}${d}`;

        return new Promise((resolve) => {
          debug("DROPPING", path_to_remove);
          rimraf(path_to_remove, { maxBusyTries: 100 }, (e) => {
            // debug('DROPPING RESULT', e);
            resolve();
          });
        });
      })
    );
  }

  async getProfileDataToUpdate() {
    const zipPath = join(this.tmpdir, `gologin_${this.profile_id}_upload.zip`);
    const zipExists = await access(zipPath)
      .then(() => true)
      .catch(() => false);
    if (zipExists) {
      await unlink(zipPath);
    }

    await this.sanitizeProfile();
    debug("profile sanitized");

    const profilePath = this.profilePath();
    const fileBuff = await archiveProfile(profilePath);

    debug("PROFILE ZIP CREATED", profilePath, zipPath);

    return fileBuff;
  }

  async profileExists() {
    const profileResponse = await requests.post(`${API_URL}/browser`, {
      headers: {
        Authorization: `Bearer ${this.access_token}`,
      },
      json: {},
    });

    if (profileResponse.statusCode !== 200) {
      return false;
    }

    debug("profile is", profileResponse.body);

    return true;
  }

  async getRandomFingerprint(options) {
    // Validate Useragent
    // Validate maxTouchPoints
    // Validate resolution
    do {
      let os = "lin";

      if (options.os) {
        os = options.os;
      }

      const fingerprint = await requests.get(
        `${API_URL}/browser/fingerprint?os=${os}`,
        {
          headers: {
            Authorization: `Bearer ${this.access_token}`,
            "User-Agent": "gologin-api",
          },
        }
      );
      const fingerprintJSON = JSON.parse(fingerprint.body);

      if (
        fingerprintJSON.navigator.maxTouchPoints != 0 ||
        (os == "lin" &&
          !fingerprintJSON.navigator.userAgent
            .toLowerCase()
            .includes("linux")) ||
        (os == "win" &&
          (!fingerprintJSON.navigator.userAgent
            .toLowerCase()
            .includes("windows nt 10.0") ||
            !(fingerprintJSON.navigator.deviceMemory >= 2))) ||
        !fingerprintJSON.navigator.language.includes("q=0.9") ||
        !(
          getWebGLRendererConfidence(fingerprintJSON.webGLMetadata.renderer)
            .grade == "A"
        )
      ) {
        await delay(1000);
        continue;
      }

      // console.log(
      //   `[Cluster ${process.env.pm_id}][GOLOGIN] Created fingerprint for OS: ${os}`
      // );
      // console.log(fingerprintJSON);

      return fingerprintJSON;
    } while (true);
  }

  async create(options) {
    debug("createProfile", options);

    const fingerprint = await this.getRandomFingerprint(options);
    debug("fingerprint=", fingerprint);

    if (fingerprint.statusCode === 500) {
      throw new Error("no valid random fingerprint check os param");
    }

    if (fingerprint.statusCode === 401) {
      throw new Error("invalid token");
    }

    const { navigator, fonts, webGLMetadata, webRTC } = fingerprint;
    let deviceMemory = navigator.deviceMemory || 2;
    if (deviceMemory < 1) {
      deviceMemory = 1;
    }

    // Fixed deviceMemory
    // navigator.deviceMemory = deviceMemory * 1024;
    navigator.deviceMemory = deviceMemory;
    webGLMetadata.mode = webGLMetadata.mode === "noise" ? "mask" : "off";

    // Fixed bypassing anti-bot
    // navigator.doNotTrack = false;
    // navigator.maxTouchPoints = 0;

    const json = {
      ...fingerprint,
      navigator,
      webGLMetadata,
      browserType: "chrome",
      name: "default_name",
      fonts: {
        families: fonts,
      },
      webRTC: {
        ...webRTC,
        mode: "alerted",
      },
      isM1: false,
      mediaDevices: {
        videoInputs: fingerprint.mediaDevices?.videoInputs || 0,
        audioInputs: fingerprint.mediaDevices?.audioInputs || 0,
        audioOutputs: fingerprint.mediaDevices?.audioOutputs || 0,
        enableMasking: true,
      },
    };

    const user_agent = options.navigator?.userAgent;
    const orig_user_agent = json.navigator.userAgent;
    Object.keys(options).map((e) => {
      json[e] = options[e];
    });
    if (user_agent === "random") {
      json.navigator.userAgent = orig_user_agent;
    }
    // console.log('profileOptions', json);

    const response = await requests.post(`${API_URL}/browser`, {
      headers: {
        Authorization: `Bearer ${this.access_token}`,
        "User-Agent": "gologin-api",
      },
      json,
    });

    if (response.statusCode === 400) {
      throw new Error(
        `gologin failed account creation with status code, ${
          response.statusCode
        } DATA  ${JSON.stringify(response.body.message)}`
      );
    }

    if (response.statusCode === 500) {
      throw new Error(
        `gologin failed account creation with status code, ${response.statusCode}`
      );
    }

    debug(JSON.stringify(response.body));

    return response.body.id;
  }

  async delete(pid) {
    const profile_id = pid || this.profile_id;
    await requests.delete(`${API_URL}/browser/${profile_id}`, {
      headers: {
        Authorization: `Bearer ${this.access_token}`,
        "User-Agent": "gologin-api",
      },
    });
  }

  async update(options) {
    this.profile_id = options.id;
    const profile = await this.getProfile();

    if (options.navigator) {
      Object.keys(options.navigator).map((e) => {
        profile.navigator[e] = options.navigator[e];
      });
    }

    Object.keys(options)
      .filter((e) => e !== "navigator")
      .map((e) => {
        profile[e] = options[e];
      });

    await this.uploadS3ProfileJson(
      this.profile_id,
      Buffer.from(JSON.stringify(profile))
    );

    // debug("update profile", profile);
    // const response = await requests.put(
    //   `https://api.gologin.com/browser/${options.id}`,
    //   {
    //     json: profile,
    //     headers: {
    //       Authorization: `Bearer ${this.access_token}`,
    //     },
    //   }
    // );

    // debug("response", JSON.stringify(response.body));

    return true;
    // return response.body;
  }

  setActive(is_active) {
    this.is_active = is_active;
  }

  getGeolocationParams(profileGeolocationParams, tzGeolocationParams) {
    if (profileGeolocationParams.fillBasedOnIp) {
      return {
        mode: profileGeolocationParams.mode,
        latitude: Number(tzGeolocationParams.latitude),
        longitude: Number(tzGeolocationParams.longitude),
        accuracy: Number(tzGeolocationParams.accuracy),
      };
    }

    return {
      mode: profileGeolocationParams.mode,
      latitude: profileGeolocationParams.latitude,
      longitude: profileGeolocationParams.longitude,
      accuracy: profileGeolocationParams.accuracy,
    };
  }

  getViewPort() {
    return { ...this.resolution };
  }

  async postCookies(profileId, cookies) {
    const formattedCookies = cookies.map((cookie) => {
      if (
        !["no_restriction", "lax", "strict", "unspecified"].includes(
          cookie.sameSite
        )
      ) {
        cookie.sameSite = "unspecified";
      }

      return cookie;
    });

    const response = await uploadCookies({
      profileId,
      cookies: formattedCookies,
      API_BASE_URL: API_URL,
      ACCESS_TOKEN: this.access_token,
    });

    if (response.statusCode === 200) {
      return response.body;
    }

    return {
      status: "failure",
      status_code: response.statusCode,
      body: response.body,
    };
  }

  async getCookies(profileId) {
    const response = await downloadCookies({
      profileId,
      API_BASE_URL: API_URL,
      ACCESS_TOKEN: this.access_token,
    });

    return response.body;
  }

  async writeCookiesToFile() {
    const cookies = await this.getCookies(this.profile_id);
    if (!cookies.length) {
      return;
    }

    const resultCookies = cookies.map((el) => ({
      ...el,
      value: Buffer.from(el.value),
    }));

    let db;
    try {
      db = await getDB(this.cookiesFilePath, false);
      const chunckInsertValues = getChunckedInsertValues(resultCookies);

      for (const [query, queryParams] of chunckInsertValues) {
        const insertStmt = await db.prepare(query);
        await insertStmt.run(queryParams);
        await insertStmt.finalize();
      }
    } catch (error) {
      console.log(error.message);
    } finally {
      (await db) && db.close();
    }
  }

  async uploadProfileCookiesToServer() {
    const cookies = await loadCookiesFromFile(this.cookiesFilePath);
    if (!cookies.length) {
      return;
    }

    return this.postCookies(this.profile_id, cookies);
  }

  async start() {
    if (this.is_remote) {
      return this.startRemote();
    }

    if (!this.executablePath) {
      await this.checkBrowser();
    }

    const ORBITA_BROWSER =
      this.executablePath || this.browserChecker.getOrbitaPath;

    const orbitaBrowserExists = await access(ORBITA_BROWSER)
      .then(() => true)
      .catch(() => false);
    if (!orbitaBrowserExists) {
      throw new Error(
        `Orbita browser is not exists on path ${ORBITA_BROWSER}, check executablePath param`
      );
    }
    await this.createStartup();
    // await this.createBrowserExtension();
    const wsUrl = await this.spawnBrowser();
    this.setActive(true);

    return { status: "success", wsUrl };
  }

  async startLocal() {
    await this.createStartup(true);
    // await this.createBrowserExtension();
    const wsUrl = await this.spawnBrowser();
    this.setActive(true);

    return { status: "success", wsUrl };
  }

  async stop() {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (this.is_remote) {
      return this.stopRemote();
    }

    await this.stopAndCommit({ posting: true }, false);
  }

  async stopLocal(options) {
    const opts = options || { posting: false };
    await this.stopAndCommit(opts, true);
  }

  async waitDebuggingUrl(delay_ms, try_count = 0) {
    await delay(delay_ms);
    const url = `https://${this.profile_id}.orbita.gologin.com/json/version`;
    console.log("try_count=", try_count, "url=", url);
    const response = await requests.get(url);
    let wsUrl = "";
    console.log("response", response.body);

    if (!response.body) {
      return wsUrl;
    }

    try {
      const parsedBody = JSON.parse(response.body);
      wsUrl = parsedBody.webSocketDebuggerUrl;
    } catch (e) {
      if (try_count < 3) {
        return this.waitDebuggingUrl(delay_ms, try_count + 1);
      }

      return {
        status: "failure",
        wsUrl,
        message: "Check proxy settings",
        profile_id: this.profile_id,
      };
    }

    wsUrl = wsUrl
      .replace("ws://", "wss://")
      .replace("127.0.0.1", `${this.profile_id}.orbita.gologin.com`);

    return wsUrl;
  }

  async startRemote(delay_ms = 10000) {
    debug(`startRemote ${this.profile_id}`);

    /*
    if (profileResponse.statusCode !== 202) {
      return {'status': 'failure', 'code':  profileResponse.statusCode};
    }
    */

    // if (profileResponse.body === 'ok') {
    const profile = await this.getProfile();

    const profileResponse = await requests.post(
      `https://api.gologin.com/browser/${this.profile_id}/web`,
      {
        headers: {
          Authorization: `Bearer ${this.access_token}`,
        },
      }
    );

    debug("profileResponse", profileResponse.statusCode, profileResponse.body);

    if (profileResponse.statusCode === 401) {
      throw new Error("invalid token");
    }

    const { navigator = {}, fonts, os: profileOs } = profile;
    this.fontsMasking = fonts?.enableMasking;
    this.profileOs = profileOs;
    this.differentOs =
      profileOs !== "android" &&
      ((OS_PLATFORM === "win32" && profileOs !== "win") ||
        (OS_PLATFORM === "darwin" && profileOs !== "mac") ||
        (OS_PLATFORM === "linux" && profileOs !== "lin"));

    const { resolution = "1920x1080", language = "en-US,en;q=0.9" } = navigator;

    this.language = language;
    const [screenWidth, screenHeight] = resolution.split("x");
    this.resolution = {
      width: parseInt(screenWidth, 10),
      height: parseInt(screenHeight, 10),
    };

    const wsUrl = await this.waitDebuggingUrl(delay_ms);
    if (wsUrl !== "") {
      return { status: "success", wsUrl };
    }

    return { status: "failure", message: profileResponse.body };
  }

  async stopRemote() {
    debug(`stopRemote ${this.profile_id}`);
    const profileResponse = await requests.delete(
      `https://api.gologin.com/browser/${this.profile_id}/web`,
      {
        headers: {
          Authorization: `Bearer ${this.access_token}`,
        },
      }
    );

    console.log(`stopRemote ${profileResponse.body}`);
    if (profileResponse.body) {
      return JSON.parse(profileResponse.body);
    }
  }

  getAvailableFonts() {
    return fontsCollection
      .filter((elem) => elem.fileNames)
      .map((elem) => elem.name);
  }

  async changeProfileResolution(resolution) {
    return updateProfileResolution(
      this.profile_id,
      this.access_token,
      resolution
    );
  }

  async changeProfileUserAgent(userAgent) {
    return updateProfileUserAgent(
      this.profile_id,
      this.access_token,
      userAgent
    );
  }

  async changeProfileProxy(proxyData) {
    return updateProfileProxy(this.profile_id, this.access_token, proxyData);
  }
}

// CHECK GPU
// Detect gibberish
const accept = {
  aa: 1,
  ab: 1,
  ac: 1,
  ad: 1,
  ae: 1,
  af: 1,
  ag: 1,
  ah: 1,
  ai: 1,
  aj: 1,
  ak: 1,
  al: 1,
  am: 1,
  an: 1,
  ao: 1,
  ap: 1,
  aq: 1,
  ar: 1,
  as: 1,
  at: 1,
  au: 1,
  av: 1,
  aw: 1,
  ax: 1,
  ay: 1,
  az: 1,
  ba: 1,
  bb: 1,
  bc: 1,
  bd: 1,
  be: 1,
  bf: 1,
  bg: 1,
  bh: 1,
  bi: 1,
  bj: 1,
  bk: 1,
  bl: 1,
  bm: 1,
  bn: 1,
  bo: 1,
  bp: 1,
  br: 1,
  bs: 1,
  bt: 1,
  bu: 1,
  bv: 1,
  bw: 1,
  bx: 1,
  by: 1,
  ca: 1,
  cb: 1,
  cc: 1,
  cd: 1,
  ce: 1,
  cg: 1,
  ch: 1,
  ci: 1,
  ck: 1,
  cl: 1,
  cm: 1,
  cn: 1,
  co: 1,
  cp: 1,
  cq: 1,
  cr: 1,
  cs: 1,
  ct: 1,
  cu: 1,
  cw: 1,
  cy: 1,
  cz: 1,
  da: 1,
  db: 1,
  dc: 1,
  dd: 1,
  de: 1,
  df: 1,
  dg: 1,
  dh: 1,
  di: 1,
  dj: 1,
  dk: 1,
  dl: 1,
  dm: 1,
  dn: 1,
  do: 1,
  dp: 1,
  dq: 1,
  dr: 1,
  ds: 1,
  dt: 1,
  du: 1,
  dv: 1,
  dw: 1,
  dx: 1,
  dy: 1,
  dz: 1,
  ea: 1,
  eb: 1,
  ec: 1,
  ed: 1,
  ee: 1,
  ef: 1,
  eg: 1,
  eh: 1,
  ei: 1,
  ej: 1,
  ek: 1,
  el: 1,
  em: 1,
  en: 1,
  eo: 1,
  ep: 1,
  eq: 1,
  er: 1,
  es: 1,
  et: 1,
  eu: 1,
  ev: 1,
  ew: 1,
  ex: 1,
  ey: 1,
  ez: 1,
  fa: 1,
  fb: 1,
  fc: 1,
  fd: 1,
  fe: 1,
  ff: 1,
  fg: 1,
  fh: 1,
  fi: 1,
  fj: 1,
  fk: 1,
  fl: 1,
  fm: 1,
  fn: 1,
  fo: 1,
  fp: 1,
  fr: 1,
  fs: 1,
  ft: 1,
  fu: 1,
  fw: 1,
  fy: 1,
  ga: 1,
  gb: 1,
  gc: 1,
  gd: 1,
  ge: 1,
  gf: 1,
  gg: 1,
  gh: 1,
  gi: 1,
  gj: 1,
  gk: 1,
  gl: 1,
  gm: 1,
  gn: 1,
  go: 1,
  gp: 1,
  gr: 1,
  gs: 1,
  gt: 1,
  gu: 1,
  gw: 1,
  gy: 1,
  gz: 1,
  ha: 1,
  hb: 1,
  hc: 1,
  hd: 1,
  he: 1,
  hf: 1,
  hg: 1,
  hh: 1,
  hi: 1,
  hj: 1,
  hk: 1,
  hl: 1,
  hm: 1,
  hn: 1,
  ho: 1,
  hp: 1,
  hq: 1,
  hr: 1,
  hs: 1,
  ht: 1,
  hu: 1,
  hv: 1,
  hw: 1,
  hy: 1,
  ia: 1,
  ib: 1,
  ic: 1,
  id: 1,
  ie: 1,
  if: 1,
  ig: 1,
  ih: 1,
  ii: 1,
  ij: 1,
  ik: 1,
  il: 1,
  im: 1,
  in: 1,
  io: 1,
  ip: 1,
  iq: 1,
  ir: 1,
  is: 1,
  it: 1,
  iu: 1,
  iv: 1,
  iw: 1,
  ix: 1,
  iy: 1,
  iz: 1,
  ja: 1,
  jc: 1,
  je: 1,
  ji: 1,
  jj: 1,
  jk: 1,
  jn: 1,
  jo: 1,
  ju: 1,
  ka: 1,
  kb: 1,
  kc: 1,
  kd: 1,
  ke: 1,
  kf: 1,
  kg: 1,
  kh: 1,
  ki: 1,
  kj: 1,
  kk: 1,
  kl: 1,
  km: 1,
  kn: 1,
  ko: 1,
  kp: 1,
  kr: 1,
  ks: 1,
  kt: 1,
  ku: 1,
  kv: 1,
  kw: 1,
  ky: 1,
  la: 1,
  lb: 1,
  lc: 1,
  ld: 1,
  le: 1,
  lf: 1,
  lg: 1,
  lh: 1,
  li: 1,
  lj: 1,
  lk: 1,
  ll: 1,
  lm: 1,
  ln: 1,
  lo: 1,
  lp: 1,
  lq: 1,
  lr: 1,
  ls: 1,
  lt: 1,
  lu: 1,
  lv: 1,
  lw: 1,
  lx: 1,
  ly: 1,
  lz: 1,
  ma: 1,
  mb: 1,
  mc: 1,
  md: 1,
  me: 1,
  mf: 1,
  mg: 1,
  mh: 1,
  mi: 1,
  mj: 1,
  mk: 1,
  ml: 1,
  mm: 1,
  mn: 1,
  mo: 1,
  mp: 1,
  mq: 1,
  mr: 1,
  ms: 1,
  mt: 1,
  mu: 1,
  mv: 1,
  mw: 1,
  my: 1,
  na: 1,
  nb: 1,
  nc: 1,
  nd: 1,
  ne: 1,
  nf: 1,
  ng: 1,
  nh: 1,
  ni: 1,
  nj: 1,
  nk: 1,
  nl: 1,
  nm: 1,
  nn: 1,
  no: 1,
  np: 1,
  nq: 1,
  nr: 1,
  ns: 1,
  nt: 1,
  nu: 1,
  nv: 1,
  nw: 1,
  nx: 1,
  ny: 1,
  nz: 1,
  oa: 1,
  ob: 1,
  oc: 1,
  od: 1,
  oe: 1,
  of: 1,
  og: 1,
  oh: 1,
  oi: 1,
  oj: 1,
  ok: 1,
  ol: 1,
  om: 1,
  on: 1,
  oo: 1,
  op: 1,
  oq: 1,
  or: 1,
  os: 1,
  ot: 1,
  ou: 1,
  ov: 1,
  ow: 1,
  ox: 1,
  oy: 1,
  oz: 1,
  pa: 1,
  pb: 1,
  pc: 1,
  pd: 1,
  pe: 1,
  pf: 1,
  pg: 1,
  ph: 1,
  pi: 1,
  pj: 1,
  pk: 1,
  pl: 1,
  pm: 1,
  pn: 1,
  po: 1,
  pp: 1,
  pr: 1,
  ps: 1,
  pt: 1,
  pu: 1,
  pw: 1,
  py: 1,
  pz: 1,
  qa: 1,
  qe: 1,
  qi: 1,
  qo: 1,
  qr: 1,
  qs: 1,
  qt: 1,
  qu: 1,
  ra: 1,
  rb: 1,
  rc: 1,
  rd: 1,
  re: 1,
  rf: 1,
  rg: 1,
  rh: 1,
  ri: 1,
  rj: 1,
  rk: 1,
  rl: 1,
  rm: 1,
  rn: 1,
  ro: 1,
  rp: 1,
  rq: 1,
  rr: 1,
  rs: 1,
  rt: 1,
  ru: 1,
  rv: 1,
  rw: 1,
  rx: 1,
  ry: 1,
  rz: 1,
  sa: 1,
  sb: 1,
  sc: 1,
  sd: 1,
  se: 1,
  sf: 1,
  sg: 1,
  sh: 1,
  si: 1,
  sj: 1,
  sk: 1,
  sl: 1,
  sm: 1,
  sn: 1,
  so: 1,
  sp: 1,
  sq: 1,
  sr: 1,
  ss: 1,
  st: 1,
  su: 1,
  sv: 1,
  sw: 1,
  sy: 1,
  sz: 1,
  ta: 1,
  tb: 1,
  tc: 1,
  td: 1,
  te: 1,
  tf: 1,
  tg: 1,
  th: 1,
  ti: 1,
  tj: 1,
  tk: 1,
  tl: 1,
  tm: 1,
  tn: 1,
  to: 1,
  tp: 1,
  tr: 1,
  ts: 1,
  tt: 1,
  tu: 1,
  tv: 1,
  tw: 1,
  tx: 1,
  ty: 1,
  tz: 1,
  ua: 1,
  ub: 1,
  uc: 1,
  ud: 1,
  ue: 1,
  uf: 1,
  ug: 1,
  uh: 1,
  ui: 1,
  uj: 1,
  uk: 1,
  ul: 1,
  um: 1,
  un: 1,
  uo: 1,
  up: 1,
  uq: 1,
  ur: 1,
  us: 1,
  ut: 1,
  uu: 1,
  uv: 1,
  uw: 1,
  ux: 1,
  uy: 1,
  uz: 1,
  va: 1,
  vc: 1,
  vd: 1,
  ve: 1,
  vg: 1,
  vi: 1,
  vl: 1,
  vn: 1,
  vo: 1,
  vr: 1,
  vs: 1,
  vt: 1,
  vu: 1,
  vv: 1,
  vy: 1,
  vz: 1,
  wa: 1,
  wb: 1,
  wc: 1,
  wd: 1,
  we: 1,
  wf: 1,
  wg: 1,
  wh: 1,
  wi: 1,
  wj: 1,
  wk: 1,
  wl: 1,
  wm: 1,
  wn: 1,
  wo: 1,
  wp: 1,
  wr: 1,
  ws: 1,
  wt: 1,
  wu: 1,
  ww: 1,
  wy: 1,
  wz: 1,
  xa: 1,
  xb: 1,
  xc: 1,
  xe: 1,
  xf: 1,
  xg: 1,
  xh: 1,
  xi: 1,
  xl: 1,
  xm: 1,
  xn: 1,
  xo: 1,
  xp: 1,
  xq: 1,
  xs: 1,
  xt: 1,
  xu: 1,
  xv: 1,
  xw: 1,
  xx: 1,
  xy: 1,
  ya: 1,
  yb: 1,
  yc: 1,
  yd: 1,
  ye: 1,
  yf: 1,
  yg: 1,
  yh: 1,
  yi: 1,
  yj: 1,
  yk: 1,
  yl: 1,
  ym: 1,
  yn: 1,
  yo: 1,
  yp: 1,
  yr: 1,
  ys: 1,
  yt: 1,
  yu: 1,
  yv: 1,
  yw: 1,
  yx: 1,
  yz: 1,
  za: 1,
  zb: 1,
  zc: 1,
  zd: 1,
  ze: 1,
  zg: 1,
  zh: 1,
  zi: 1,
  zj: 1,
  zk: 1,
  zl: 1,
  zm: 1,
  zn: 1,
  zo: 1,
  zp: 1,
  zq: 1,
  zs: 1,
  zt: 1,
  zu: 1,
  zv: 1,
  zw: 1,
  zy: 1,
  zz: 1,
};

const gibberish = (str, { strict = false } = {}) => {
  if (!str) {
    return [];
  }
  // test letter case sequence
  const letterCaseSequenceGibbers = [];
  const tests = [
    /([A-Z]{3,}[a-z])/g, // ABCd
    /([a-z][A-Z]{3,})/g, // aBCD
    /([a-z][A-Z]{2,}[a-z])/g, // aBC...z
    /([a-z][\d]{2,}[a-z])/g, // a##...b
    /([A-Z][\d]{2,}[a-z])/g, // A##...b
    /([a-z][\d]{2,}[A-Z])/g, // a##...B
  ];
  tests.forEach((regExp) => {
    const match = str.match(regExp);
    if (match) {
      return letterCaseSequenceGibbers.push(match.join(", "));
    }
    return;
  });

  // test letter sequence
  const letterSequenceGibbers = [];
  const clean = str
    .toLowerCase()
    .replace(/\d|\W|_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .join("_");
  const len = clean.length;
  const arr = [...clean];
  arr.forEach((char, index) => {
    const next = index + 1;
    if (arr[next] == "_" || char == "_" || next == len) {
      return true;
    }
    const combo = char + arr[index + 1];
    const acceptable = !!accept[combo];
    !acceptable && letterSequenceGibbers.push(combo);
    return;
  });

  const gibbers = [
    // ignore sequence if less than 3 exist
    ...(!strict && letterSequenceGibbers.length < 3
      ? []
      : letterSequenceGibbers),
    ...(!strict && letterCaseSequenceGibbers.length < 4
      ? []
      : letterCaseSequenceGibbers),
  ];

  const allow = [
    // known gibbers
    "bz",
    "cf",
    "fx",
    "mx",
    "vb",
    "xd",
    "gx",
    "PCIe",
    "vm",
    "NVIDIAGa",
  ];
  return gibbers.filter((x) => !allow.includes(x));
};

function compressWebGLRenderer(x) {
  if (!x) return;

  return ("" + x)
    .replace(
      /ANGLE \(|\sDirect3D.+|\sD3D.+|\svs_.+\)|\((DRM|POLARIS|LLVM).+|Mesa.+|(ATI|INTEL)-.+|Metal\s-\s.+|NVIDIA\s[\d|\.]+/gi,
      ""
    )
    .replace(/(\s(ti|\d{1,2}GB|super)$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(
      /((r|g)(t|)(x|s|\d) |Graphics |GeForce |Radeon (HD |Pro |))(\d+)/i,
      (...args) => {
        return `${args[1]}${args[6][0]}${args[6]
          .slice(1)
          .replace(/\d/g, "0")}s`;
      }
    );
}

const getWebGLRendererParts = (x) => {
  const knownParts = [
    "AMD",
    "ANGLE",
    "ASUS",
    "ATI",
    "ATI Radeon",
    "ATI Technologies Inc",
    "Adreno",
    "Android Emulator",
    "Apple",
    "Apple GPU",
    "Apple M1",
    "Chipset",
    "D3D11",
    "Direct3D",
    "Express Chipset",
    "GeForce",
    "Generation",
    "Generic Renderer",
    "Google",
    "Google SwiftShader",
    "Graphics",
    "Graphics Media Accelerator",
    "HD Graphics Family",
    "Intel",
    "Intel(R) HD Graphics",
    "Intel(R) UHD Graphics",
    "Iris",
    "KBL Graphics",
    "Mali",
    "Mesa",
    "Mesa DRI",
    "Metal",
    "Microsoft",
    "Microsoft Basic Render Driver",
    "Microsoft Corporation",
    "NVIDIA",
    "NVIDIA Corporation",
    "NVIDIAGameReadyD3D",
    "OpenGL",
    "OpenGL Engine",
    "Open Source Technology Center",
    "Parallels",
    "Parallels Display Adapter",
    "PCIe",
    "Plus Graphics",
    "PowerVR",
    "Pro Graphics",
    "Quadro",
    "Radeon",
    "Radeon Pro",
    "Radeon Pro Vega",
    "Samsung",
    "SSE2",
    "VMware",
    "VMware SVGA 3D",
    "Vega",
    "VirtualBox",
    "VirtualBox Graphics Adapter",
    "Vulkan",
    "Xe Graphics",
    "llvmpipe",
  ];
  const parts = [...knownParts].filter((name) => ("" + x).includes(name));
  return [...new Set(parts)].sort().join(", ");
};

const hardenWebGLRenderer = (x) => {
  const gpuHasKnownParts = getWebGLRendererParts(x).length;
  return gpuHasKnownParts ? compressWebGLRenderer(x) : x;
};

const getWebGLRendererConfidence = (x) => {
  if (!x) {
    return;
  }
  const parts = getWebGLRendererParts(x);
  const hasKnownParts = parts.length;
  const hasBlankSpaceNoise = /\s{2,}|^\s|\s$/.test(x);
  const hasBrokenAngleStructure =
    /^ANGLE/.test(x) && !(/^ANGLE \((.+)\)/.exec(x) || [])[1];

  // https://chromium.googlesource.com/angle/angle/+/83fa18905d8fed4f394e4f30140a83a3e76b1577/src/gpu_info_util/SystemInfo.cpp
  // https://chromium.googlesource.com/angle/angle/+/83fa18905d8fed4f394e4f30140a83a3e76b1577/src/gpu_info_util/SystemInfo.h
  // https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gl/gl_version_info.cc
  /*
	const knownVendors = [
		'AMD',
		'ARM',
		'Broadcom',
		'Google',
		'ImgTec',
		'Intel',
		'Kazan',
		'NVIDIA',
		'Qualcomm',
		'VeriSilicon',
		'Vivante',
		'VMWare',
		'Apple',
		'Unknown'
	]
	const angle = {
		vendorId: (/^ANGLE \(([^,]+),/.exec(x)||[])[1] || knownVendors.find(vendor => x.includes(vendor)),
		deviceId: (
			(x.match(/,/g)||[]).length == 2 ? (/^ANGLE \(([^,]+), ([^,]+)[,|\)]/.exec(x)||[])[2] :
				(/^ANGLE \(([^,]+), ([^,]+)[,|\)]/.exec(x)||[])[1] || (/^ANGLE \((.+)\)$/.exec(x)||[])[1]
		).replace(/\sDirect3D.+/, '')
	}
	*/

  const gibbers = gibberish(x, { strict: true }).join(", ");
  const valid =
    hasKnownParts && !hasBlankSpaceNoise && !hasBrokenAngleStructure;
  const confidence =
    valid && !gibbers.length
      ? "high"
      : valid && gibbers.length
      ? "moderate"
      : "low";
  const grade =
    confidence == "high" ? "A" : confidence == "moderate" ? "C" : "F";

  const warnings = new Set([
    hasBlankSpaceNoise ? "found extra spaces" : undefined,
    hasBrokenAngleStructure ? "broken angle structure" : undefined,
  ]);
  warnings.delete(undefined);

  return {
    parts,
    warnings: [...warnings],
    gibbers,
    confidence,
    grade,
  };
};

export default GoLogin;
