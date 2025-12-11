/**
 * Optional parameters for image upload
 */
export interface UploadOptions {
  /** Cloudinary folder to organize uploads */
  folder?: string;
  /** Custom public ID for the uploaded asset */
  publicId?: string;
  /** Tags to assign to the uploaded asset */
  tags?: string[];
  /** Contextual metadata as key-value pairs */
  context?: Record<string, string>;
  /** Whether to overwrite existing asset with same public ID */
  overwrite?: boolean;
}

/**
 * Options for deleting images
 */
export interface DeleteOptions {
  /** Resource type (image, video, or raw) */
  resourceType?: 'image' | 'video' | 'raw';
  /** Whether to invalidate CDN cache */
  invalidate?: boolean;
}
