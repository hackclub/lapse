import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";

const API_URL = "https://api.lapse.hackclub.com";
const CLIENT_ID = "svc_85fdbf6c38dd4a6abbd9d002";

interface User {
  id: string;
  handle: string;
  displayName: string;
  profilePictureUrl: string | null;
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const res = await api.user.myself({});
      if (res.ok && res.data.user) {
        const u = res.data.user;
        setUser({
          id: u.id,
          handle: u.handle,
          displayName: u.displayName,
          profilePictureUrl: u.profilePictureUrl ?? null,
        });
      } else {
        await invoke("auth_clear_token");
        setToken(null);
        setUser(null);
      }
    } catch {
      await invoke("auth_clear_token");
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await invoke<string | null>("auth_get_token");
      if (stored) {
        setToken(stored);
        await fetchUser();
      }
      setIsLoading(false);
    })();
  }, [fetchUser]);

  const login = useCallback(async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const initResult = await invoke<{ authorize_url: string }>(
        "auth_initiate"
      );
      await openUrl(initResult.authorize_url);

      const callbackResult = await invoke<{
        code: string;
        code_verifier: string;
      }>("auth_await_callback");

      const response = await fetch(`${API_URL}/api/auth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: callbackResult.code,
          redirect_uri: "http://localhost:8765/auth/callback",
          client_id: CLIENT_ID,
          code_verifier: callbackResult.code_verifier,
        }),
      });

      if (!response.ok) {
        throw new Error("Token exchange failed");
      }

      const data = await response.json();
      await invoke("auth_set_token", { token: data.access_token });
      setToken(data.access_token);
      await fetchUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setIsLoggingIn(false);
    }
  }, [fetchUser]);

  const logout = useCallback(async () => {
    await invoke("auth_clear_token");
    setToken(null);
    setUser(null);
  }, []);

  return { token, user, isLoading, isLoggingIn, error, login, logout };
}
