import { type Processor } from "bullmq";

import type { CryptographicData, S3Object } from "../common";

export const COMBINE_VIDEO_QUEUE_NAME = "combineVideo";
export interface CombineVideoJob {
    /**
     * If specified, the inputs will be decrypted via a key/IV pair derived from the specified data and
     * their indices. Additionally, the thumbnail and video output will also be encrypted with
     * the key/IV pair.
     */
    crypto?: CryptographicData;

    /**
     * The name of the input S3 bucket to read the inputs from.
     */
    inputBucket: string;

    /**
     * S3 object names of the chunks to combine. The order of the array determines the order in which
     * the chunks will be combined.
     */
    inputs: string[];

    /**
     * The bucket/object name pair to associate with the output video stream.
     * This will be encrypted if `crypto` is provided.
     */
    videoOutput: S3Object;

    /**
     * The bucket/object name pair to associate with the output thumbnail image.
     * This will be encrypted if `crypto` is provided.
     */
    thumbnailOutput: S3Object;
}

export interface CombineVideoResult {
    /**
     * Equal to the `videoOutput` value provided in `CombineVideoJob`.
     */
    videoOutput: S3Object;

    /**
     * Equal to the `thumbnailObject` value provided in `CombineVideoJob`.
     */
    thumbnailObject: S3Object;
}

export const combineVideo: Processor<CombineVideoJob, CombineVideoResult, string> = async (job) => {
    
};
