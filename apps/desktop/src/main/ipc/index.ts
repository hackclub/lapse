import { registerCaptureHandlers } from "./capture";
import { registerStorageHandlers } from "./storage";
import { registerAuthHandlers } from "./auth";
import { registerUploadHandlers } from "./upload";
import { registerSystemHandlers } from "./system";

export function registerIpcHandlers() {
  registerCaptureHandlers();
  registerStorageHandlers();
  registerAuthHandlers();
  registerUploadHandlers();
  registerSystemHandlers();
}
