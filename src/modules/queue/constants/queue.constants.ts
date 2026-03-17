export const VIDEO_GENERATION_QUEUE = 'video-generation';

export enum VideoJobName {
  GENERATE = 'generate',
}

/** Kept for backwards-compat; prefer VideoJobName.GENERATE */
export const VIDEO_GENERATION_JOB = VideoJobName.GENERATE;
