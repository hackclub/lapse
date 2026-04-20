import { ipcMain } from "electron";
import { authService } from "../auth/oauthFlow";
import { apiClient } from "../auth/apiClient";

export function registerAuthHandlers() {
  ipcMain.handle("auth:login", async () => {
    try {
      await authService.login();
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle("auth:logout", async () => {
    return authService.logout();
  });

  ipcMain.handle("auth:get-token", async () => {
    return authService.getToken();
  });

  ipcMain.handle("auth:set-token", async (_event, token: string) => {
    try {
      await authService.setToken(token);
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle("auth:get-user", async () => {
    const token = authService.getToken();
    if (!token) return null;
    try {
      return await apiClient.getUser();
    } catch {
      return null;
    }
  });
}
