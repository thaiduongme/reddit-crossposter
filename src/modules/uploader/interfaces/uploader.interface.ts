export interface IUploader {
  uploadVideoByUrl(url: string): Promise<string>;
  isUploadedSuccessfully(url: string): Promise<boolean>;
}
