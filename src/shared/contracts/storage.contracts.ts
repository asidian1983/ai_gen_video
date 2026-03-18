/**
 * Storage Service Contract
 *
 * Stable interface for the Storage domain.
 * Consumers (Videos, Queue/Worker) depend on this interface — the S3
 * implementation detail is hidden behind the boundary.
 */

export interface IStorageService {
  uploadBuffer(buffer: Buffer, key: string, contentType?: string): Promise<string>;
  uploadFromUrl(sourceUrl: string, key: string): Promise<string>;
  getPresignedUploadUrl(key: string, expiresIn?: number): Promise<string>;
  getPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
