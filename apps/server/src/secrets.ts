import type * as db from "@/generated/prisma/client.js";

/**
 * Every column that would let its reader act as somebody else: a user on Hackatime, a recorder on Lookout, the desktop
 * publish panel, a paired device, an OAuth app, a program key.
 *
 * The database client leaves these out of every result (see `db.ts`), so a row can be logged, exported, cached or
 * returned without anyone having to remember to strip it first. Code that needs one asks for it by name, with
 * `omit: { column: false }` or a `select` - which keeps the list of places a secret is read short and greppable.
 *
 * A column that looks like a secret but isn't on this list fails `test/secrets.test.ts`.
 */
export const SECRET_COLUMNS = {
    user: {
        hackatimeAccessToken: true,
        hackatimeRefreshToken: true,
    },
    timelapse: {
        lookoutToken: true,
    },
    draftLookoutTimelapse: {
        lookoutToken: true,
        panelToken: true,
    },
    lookoutDevice: {
        tokenHash: true,
    },
    serviceClient: {
        clientSecretHash: true,
    },
    programKey: {
        keyHash: true,
    },
} as const satisfies db.Prisma.GlobalOmitConfig;

type SecretColumnsOf<M extends keyof typeof SECRET_COLUMNS> = keyof (typeof SECRET_COLUMNS)[M];

/**
 * A model as the database client returns it by default - without its secret columns.
 */
export type User = Omit<db.User, SecretColumnsOf<"user">>;
export type Timelapse = Omit<db.Timelapse, SecretColumnsOf<"timelapse">>;
export type DraftLookoutTimelapse = Omit<db.DraftLookoutTimelapse, SecretColumnsOf<"draftLookoutTimelapse">>;
export type LookoutDevice = Omit<db.LookoutDevice, SecretColumnsOf<"lookoutDevice">>;
export type ServiceClient = Omit<db.ServiceClient, SecretColumnsOf<"serviceClient">>;
export type ProgramKey = Omit<db.ProgramKey, SecretColumnsOf<"programKey">>;

/**
 * Removes the secret columns of `model` from a row, for the few places that hand a whole row to a caller. The database
 * client already leaves them out; this is for rows that might have been loaded with a secret on purpose.
 */
export function withoutSecrets<T extends Record<string, unknown>>(model: keyof typeof SECRET_COLUMNS, row: T): T {
    const secrets: Record<string, boolean> = SECRET_COLUMNS[model];
    return Object.fromEntries(Object.entries(row).filter(([column]) => !secrets[column])) as T;
}
