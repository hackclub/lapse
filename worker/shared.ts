// This file is intended to be imported from other micro-services.

export {
    COMBINE_VIDEO_QUEUE_NAME,
    type CombineVideoJob,
    type CombineVideoResult
} from "./src/workers/combineVideo";

export {
    EDIT_VIDEO_QUEUE_NAME,
    type BlurredArea,
    type EditVideoJob,
    type EditVideoResult
} from "./src/workers/editVideo";
