export interface IUploader {
  uploadVideoByUrl(url: string): Promise<string>;
  uploadVideoByPath(videoPath: string): Promise<string>;
  isUploadedSuccessfully(url: string): Promise<boolean>;
}
