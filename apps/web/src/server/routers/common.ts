import z from "zod";

import type * as db from "@/generated/prisma/client";

import { oneOf } from "@/shared/common";

/**
 * A 12-character Nano ID, used to represent all public entities.
 */
export const PublicId = z.string();

/**
 * Represents a timestamp, measured in milliseconds, since the UNIX epoch. This represents all
 * dates for the API.
 */
export const ApiDate = z.number().nonnegative();

/**
 * For functions that access protected resources, specifies that no specific actor should be used, and all resources
 * should be considered owned. This usually shouldn't be used.
 */
export type ServerActor = "SERVER";

/**
 * Represents an actor. This type is usually used in functions that access protected resources - if a protected resource is accessed using an
 * `Actor` that does not have access to said resource, an error result will be returned.
 */
export type Actor = db.User | ServerActor | null;

/**
 * Returns `true` if the actor is the server.
 */
export function actorIsServer(actor: Actor): actor is ServerActor {
    return actor === "SERVER";
}

/**
 * Returns `true` if the actor is a user.
 */
export function actorIsUser(actor: Actor): actor is db.User {
    return !actorIsServer(actor) && actor != null;
}

/**
 * Represents any object with an `ownerId` field.
 */
export interface OwnedObject {
    ownerId: string;
}

/**
 * Returns `true` if the actor is entitled to access the given `entity`.
 */
export function actorEntitledTo(entity: OwnedObject, actor: Actor) {
    return (
        actorIsServer(actor)
            ? true
            : actorIsUser(actor) && (
                entity.ownerId == actor.id ||
                actor.permissionLevel in oneOf("ADMIN", "ROOT")
            )
    );
}