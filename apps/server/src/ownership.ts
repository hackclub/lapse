import { oneOf } from "@hackclub/lapse-shared";
import type { LapseOAuthScope } from "@hackclub/lapse-api";

import type * as db from "@/generated/prisma/client.js";

/**
 * Represents the identity of an authenticated program key.
 */
export interface AuthenticatedProgramKey {
    id: string;
    name: string;
    scopes: LapseOAuthScope[];
}

/**
 * For functions that access protected resources, specifies that no specific actor should be used, and all resources
 * should be considered owned. This usually shouldn't be used.
 */
export type ServerActor = { kind: "SERVER" };

/**
 * Represents an actor authenticated as a user via OAuth2.
 */
export type UserActor = { kind: "USER"; user: db.User; scopes: LapseOAuthScope[] };

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
 * Returns `true` if the actor is entitled to elevated access to the given `entity`.
 * SERVER and PROGRAM actors are always entitled. USER actors are entitled if they own the entity or are ADMIN/ROOT.
 */
export function actorEntitledTo(entity: OwnedObject, actor: Actor | null): boolean {
    if (!actor)
        return false;

    if (actor.kind === "SERVER" || actor.kind === "PROGRAM")
        return true;

    return (
        actor.user.id === ("ownerId" in entity ? entity.ownerId : entity.authorId) ||
        actor.user.permissionLevel in oneOf("ADMIN", "ROOT")
    );
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
