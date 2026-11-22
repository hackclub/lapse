import { ORPCError, os } from "@orpc/server";
import { permissionLevelOrdinal } from "@hackclub/lapse-api";
import { oo, type OpenAPI } from "@orpc/openapi";
import type z from "zod";
import type { compositeRouterContract, LapseError, LapseOAuthScope, ProgramKeyAdminScope } from "@hackclub/lapse-api";

import { apiErr } from "@/common.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import { isAdmin, programHasAdminScope, type ExternalActor, type ProgramActor, type UserActor } from "@/ownership.js";
import type { Context } from "@/router.js";
import type * as safe from "@/secrets.js";

/**
 * Who may call a procedure, declared once per procedure in `policies.ts` and enforced here, by `authorize`, before
 * the handler runs. Handlers don't check permissions themselves: if a rule isn't in the policy, it isn't a rule.
 */
export type Policy<TInput = unknown> =
    /** Anyone, signed in or not. The handler may still show a signed-in caller more (see `actorEntitledTo`). */
    | { access: "public" }

    /** A signed-in user, acting as themselves. Program keys are refused. */
    | ({ access: "user" } & Requirements<TInput>)

    /** A signed-in user, or a program key. */
    | ({ access: "any" } & Requirements<TInput> & {
        /**
         * The admin scope a program key needs wherever a user would need to be an administrator: for a call gated by
         * `level`, or to act on a `resource` (a program key owns none). Without it, program keys can't do either.
         */
        program?: ProgramKeyAdminScope;
    });

export interface Requirements<TInput> {
    /** The scopes a third-party app's token must carry. The Lapse website's own sessions carry all of them. */
    scopes?: readonly Exclude<LapseOAuthScope, "elevated">[];

    /** Only for the Lapse website itself (the `elevated` scope), never for a third-party app. */
    firstParty?: true;

    /** Only for administrators at this level or above - which also means only on the Lapse website. */
    level?: "ADMIN" | "ROOT";

    /** What the call acts on. Its owner may; anybody else is refused. */
    resource?: ResourceRule<TInput>;
}

export interface ResourceRule<TInput> {
    kind: ResourceKind;

    /** Which one, from the procedure's input. */
    id: (input: TInput) => string;

    /** Administrators at this level or above may act on it as well as its owner. */
    alsoFor?: "ADMIN" | "ROOT";

    /** Narrows `alsoFor` to some resources only. */
    onlyIf?: (resource: Resource) => boolean;

    /** What to answer when it doesn't exist. */
    missing: (input: TInput) => Refusal;

    /** What to answer when the caller may not act on it. */
    denied: (input: TInput) => Refusal;
}

export type Refusal = { error: LapseError; message: string };

export interface Resource {
    /** `null` if nobody owns it, like the canonical OAuth client. */
    ownerId: string | null;

    /** For apps: whether this is the Lapse website's own OAuth client. */
    canonical?: boolean;
}

/**
 * How to find out who owns each kind of thing a procedure can act on. `null` means it doesn't exist.
 */
const RESOURCES = {
    // A user is their own owner, so there's nothing to look up - whether they exist is the handler's business.
    user: async (id: string): Promise<Resource | null> => ({ ownerId: id }),

    timelapse: async (id: string) => await database().timelapse.findUnique({ where: { id }, select: { ownerId: true } }),
    draftTimelapse: async (id: string) => await database().draftTimelapse.findUnique({ where: { id }, select: { ownerId: true } }),
    legacyTimelapse: async (id: string) => await database().legacyUnpublishedTimelapse.findUnique({ where: { id }, select: { ownerId: true } }),

    comment: async (id: string) => {
        const comment = await database().comment.findUnique({ where: { id }, select: { authorId: true } });
        return comment && { ownerId: comment.authorId };
    },

    app: async (id: string) => {
        const app = await database().serviceClient.findFirst({ where: { id, revokedAt: null }, select: { createdByUserId: true, clientId: true } });
        return app && { ownerId: app.createdByUserId, canonical: app.clientId === env.CANONICAL_OAUTH_CLIENT_ID };
    },

    oauthGrant: async (id: string) => {
        const grant = await database().serviceGrant.findUnique({ where: { id }, select: { userId: true } });
        return grant && { ownerId: grant.userId };
    },
} satisfies Record<string, (id: string) => Promise<Resource | null>>;

export type ResourceKind = keyof typeof RESOURCES;

type Contract = typeof compositeRouterContract;

type ContractProcedure = { "~orpc": { inputSchema?: unknown } };

type Names<T, TPrefix extends string = ""> = {
    [K in keyof T & string]: T[K] extends ContractProcedure ? `${TPrefix}${K}` : Names<T[K], `${TPrefix}${K}.`>
}[keyof T & string];

/** A procedure's input as its handler sees it, once validated. */
type InputOf<T> = T extends { "~orpc": { inputSchema?: infer TSchema } } ? (TSchema extends z.ZodType ? z.output<TSchema> : unknown) : never;

type At<T, TPath extends string> =
    TPath extends `${infer THead}.${infer TRest}` ? (THead extends keyof T ? At<T[THead], TRest> : never) :
    TPath extends keyof T ? T[TPath] : never;

/**
 * The dotted path of a procedure, e.g. `admin.programKey.create`.
 */
export type ProcedureName = Names<Contract>;

type PoliciesOf<T> = { [K in keyof T]: T[K] extends ContractProcedure ? Policy<InputOf<T[K]>> : PoliciesOf<T[K]> };

/**
 * Every procedure's policy, laid out like the contract. Being a mapped type, a procedure without one doesn't compile.
 */
export type Policies = PoliciesOf<Contract>;

/**
 * The context a handler receives once its policy has let the request through.
 */
export type AuthorizedContext<TPolicy> =
    TPolicy extends { access: "user" } ? Context & { actor: UserActor; user: safe.User } :
    TPolicy extends { access: "any" } ? Context & { actor: ExternalActor } :
    Context;

type Decision =
    | { kind: "allow" }
    | { kind: "refuse"; refusal: Refusal };

function missingScope(scope: string, required: readonly string[]) {
    return new ORPCError("FORBIDDEN", {
        message: `Missing required scope ${scope}. This endpoint requires the scopes ${required.join(", ")}.`
    });
}

/**
 * Decides whether `actor` may make a call under `policy`. Throws for a caller who may not call the procedure at all,
 * and returns a refusal for one who may not act on the particular thing they asked for.
 */
export async function decide(policy: Policy, actor: ExternalActor | null, input: unknown): Promise<Decision> {
    if (policy.access === "public")
        return { kind: "allow" };

    if (!actor)
        throw new ORPCError("UNAUTHORIZED");

    if (actor.kind === "PROGRAM")
        return await decideForProgram(policy, actor, input);

    const firstParty = actor.scopes.includes("elevated");

    // Told apart from a missing scope below, as it always has been: the website sends a signed-in user who isn't an
    // administrator to sign in again, rather than showing them an error.
    if (policy.level && permissionLevelOrdinal(actor.user.permissionLevel) < permissionLevelOrdinal(policy.level))
        throw new ORPCError("UNAUTHORIZED");

    const required = [...policy.scopes ?? [], ...(policy.firstParty || policy.level ? ["elevated" as const] : [])];
    const missing = firstParty ? undefined : required.find(scope => !actor.scopes.includes(scope));
    if (missing)
        throw missingScope(missing, required);

    if (!policy.resource)
        return { kind: "allow" };

    const rule = policy.resource;
    const resource = await RESOURCES[rule.kind](rule.id(input));
    if (!resource)
        return { kind: "refuse", refusal: rule.missing(input) };

    if (resource.ownerId === actor.user.id)
        return { kind: "allow" };

    if (rule.alsoFor && isAdmin(actor, rule.alsoFor) && (rule.onlyIf?.(resource) ?? true))
        return { kind: "allow" };

    return { kind: "refuse", refusal: rule.denied(input) };
}

async function decideForProgram(policy: Exclude<Policy, { access: "public" }>, actor: ProgramActor, input: unknown): Promise<Decision> {
    const required = policy.scopes ?? [];
    const missing = required.find(scope => !actor.programKey.scopes.includes(scope));
    if (missing)
        throw missingScope(missing, required);

    if (policy.access === "user") {
        throw new ORPCError("FORBIDDEN", {
            message: "This endpoint pertains to a calling user, but you're invoking it with a program key, which conceptually doesn't have a user associated with it."
        });
    }

    const needsAdmin = policy.level !== undefined || policy.firstParty === true || policy.resource !== undefined;
    if (!needsAdmin)
        return { kind: "allow" };

    const holdsAdminScope = policy.program !== undefined && policy.level !== "ROOT" && programHasAdminScope(actor, policy.program);

    if (!policy.resource) {
        if (!holdsAdminScope)
            throw missingScope(policy.program ?? "elevated", [...required, policy.program ?? "elevated"]);

        return { kind: "allow" };
    }

    const rule = policy.resource;
    const resource = await RESOURCES[rule.kind](rule.id(input));
    if (!resource)
        return { kind: "refuse", refusal: rule.missing(input) };

    // A program key owns nothing, so acting on anything is acting as an administrator would.
    if (holdsAdminScope && rule.alsoFor && rule.alsoFor !== "ROOT" && (rule.onlyIf?.(resource) ?? true))
        return { kind: "allow" };

    return { kind: "refuse", refusal: rule.denied(input) };
}

const POLICY_NAME = Symbol("policy");

/**
 * The name of the policy a middleware enforces, if it is one made by `authorize`.
 */
export function policyNameOf(middleware: unknown): string | undefined {
    return typeof middleware === "function" ? (middleware as { [POLICY_NAME]?: string })[POLICY_NAME] : undefined;
}

function describe(policy: Policy, operation: OpenAPI.OperationObject): OpenAPI.OperationObject {
    if (policy.access === "public")
        return operation;

    const scopes = [...policy.scopes ?? [], ...(policy.firstParty || policy.level ? ["elevated"] : [])];
    const notes: string[] = [];

    if (policy.level)
        notes.push(`When called on behalf of a user, that user must have the \`${policy.level}\` permission level or higher.`);

    if (policy.access === "user")
        notes.push("Can only be called on behalf of a user - program keys are not accepted.");
    else if (policy.program)
        notes.push(`Program keys need the \`${policy.program}\` scope${policy.resource ? " to act on what belongs to a user" : ""}.`);

    return {
        ...operation,
        security: [
            { oauth2: scopes },
            ...(policy.access === "any" ? [{ programKey: [...policy.scopes ?? [], ...(policy.program && !policy.resource ? [policy.program] : [])] }] : [])
        ],
        description: [operation.description, ...notes].filter(Boolean).join("\n\n") || undefined
    };
}

/**
 * Creates `authorize`, the one middleware every procedure starts with. It enforces the procedure's policy from
 * `policies`, and gives the handler a context that reflects it - `context.user` exists for a user-only procedure.
 */
export function createAuthorize<TPolicies extends Policies>(policies: TPolicies) {
    return function authorize<TName extends ProcedureName>(name: TName) {
        const policy = name.split(".").reduce<unknown>((table, key) => (table as Record<string, unknown>)[key], policies) as Policy;

        const middleware = os
            .$context<Context>()
            .middleware(async ({ context, next }, input, output) => {
                const decision = await decide(policy, context.actor, input);
                // `as never`, so the handler's context is inferred from `next` alone - a refusal never reaches it.
                if (decision.kind === "refuse")
                    return output(apiErr(decision.refusal.error, decision.refusal.message)) as never;

                return next({ context: context as AuthorizedContext<At<TPolicies, TName>> });
            });

        Object.defineProperty(middleware, POLICY_NAME, { value: name });
        return oo.spec(middleware, operation => describe(policy, operation));
    };
}
