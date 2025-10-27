/**
 * Returns the environment variable named `key`. If the environment variable does not exist,
 * this function will throw an error.
 */
export function requiredEnv(key: string) {
    const value = process.env[key];
    if (value)
        return value;

    throw new Error(`The environment variable ${key} is missing.`);
}