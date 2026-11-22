import { permissionLevelOrdinal, type LapseOAuthScope, type ProgramKeyAdminScope, type ProgramKeyScope } from "@hackclub/lapse-api";

import type * as safe from "@/secrets.js";

/**
 * Represents the identity of an authenticated program key.
 */
export interface AuthenticatedProgramKey {
    id: string;
    name: string;
    scopes: ProgramKeyScope[];
}

/**
 * For functions that access protected resources, specifies that no specific actor should be used, and all resources
 * should be considered owned. This usually shouldn't be used.
 */
export type ServerActor = { kind: "SERVER" };

/**
 * Represents an actor authenticated as a user via OAuth2.
 */
export type UserActor = {
    kind: "USER";
    user: safe.User;
    scopes: LapseOAuthScope[];

    /** When the user last actually signed in. Administrator powers need this to be recent - see `policy.ts`. */
    authenticatedAt: Date;
};

/**
 * Represents an actor authenticated via a program key (machine-to-machine).
 */
export type ProgramActor = { kind: "PROGRAM"; programKey: AuthenticatedProgramKey };

/**
 * Represents any actor that can call API routes — either a user or a program key.
 * Server actors are internal only and cannot appear in API context.
 */
export type ExternalActor = UserActor | ProgramActor;

/**
 * Represents any actor. This type is usually used in functions that access protected resources — if a protected
 * resource is accessed using an `Actor` that does not have access to said resource, an error result will be returned.
 */
export type Actor = ExternalActor | ServerActor;

/**
 * Returns `true` if the actor is the server.
 */
export function actorIsServer(actor: Actor): actor is ServerActor {
    return actor.kind === "SERVER";
}

/**
 * Returns `true` if the actor is a user.
 */
export function actorIsUser(actor: Actor): actor is UserActor {
    return actor.kind === "USER";
}

/**
 * Returns `true` if the actor is a program key.
 */
export function actorIsProgram(actor: Actor): actor is ProgramActor {
    return actor.kind === "PROGRAM";
}

/**
 * Represents any object with an `ownerId` or `authorId` field.
 */
export type OwnedObject = { ownerId: string; } | { authorId: string; };

/**
 * Returns `true` if the actor holds administrator power at `level` or above.
 *
 * That takes more than the permission level: the user has to be on the Lapse website itself (the `elevated` scope).
 * A third-party app an admin has signed into acts for them as an ordinary user and nothing more, so a compromised or
 * careless app can't spend their authority. Every check of somebody's permission level goes through here.
 */
export function isAdmin(actor: Actor | null, level: "ADMIN" | "ROOT" = "ADMIN"): boolean {
    return (
        actor?.kind === "USER" &&
        actor.scopes.includes("elevated") &&
        permissionLevelOrdinal(actor.user.permissionLevel) >= permissionLevelOrdinal(level)
    );
}

/**
 * Returns `true` if the actor is a program key holding the admin scope `scope`. Program keys aren't users and own
 * nothing, so this is the only way one gets to touch what belongs to somebody.
 */
export function programHasAdminScope(actor: Actor | null, scope: ProgramKeyAdminScope): boolean {
    return actor?.kind === "PROGRAM" && actor.programKey.scopes.includes(scope);
}

/**
 * Returns `true` if the actor's token or key carries `scope`. The Lapse website's own sessions carry every scope.
 */
export function actorHasScope(actor: Actor | null, scope: Exclude<LapseOAuthScope, "elevated">): boolean {
    if (!actor || actor.kind === "SERVER")
        return actor !== null;

    if (actor.kind === "PROGRAM")
        return actor.programKey.scopes.includes(scope);

    return actor.scopes.includes(scope) || actor.scopes.includes("elevated");
}

/**
 * Returns `true` if the actor may see `entity` the way its owner does, private fields and all: the owner, an
 * administrator, the server, or a program key with `admin:read`. This only ever decides what is *shown* - whether a
 * request may change something is decided by its policy (see `policy.ts`).
 */
export function actorEntitledTo(entity: OwnedObject, actor: Actor | null): boolean {
    if (!actor)
        return false;

    if (actor.kind === "SERVER")
        return true;

    if (actor.kind === "PROGRAM")
        return programHasAdminScope(actor, "admin:read");

    return actor.user.id === ("ownerId" in entity ? entity.ownerId : entity.authorId) || isAdmin(actor);
}

/**
 * Returns `true` if the actor may discover every timelapse, regardless of its visibility. Only administrators do.
 */
export function actorHasAdminView(actor: Actor | null): boolean {
    return isAdmin(actor);
}

/**
 * Converts the `actor` into a human-readable string.
 */
export function stringifyActor(actor: Actor | null): string {
    if (!actor)
        return "null";

    if (actor.kind === "USER")
        return `@${actor.user.handle} (ID ${actor.user.id})`;

    if (actor.kind === "PROGRAM")
        return `program key "${actor.programKey.name}" (ID ${actor.programKey.id})`;

    return "<server>";
}
