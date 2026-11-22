-- Program keys used to be let through every ownership and permission-level check just for being program keys.
-- They now need an admin scope for that (see `policy.ts`). So that no key already in use loses anything, each one is
-- given the scopes that spell out what it could do until now, and nothing more:
--
--   every key could see what belongs to any user                               -> admin:read
--   a key with a write scope (or `elevated`) could change it too               -> admin:write
--   a key with `elevated` passed every scope check, the admin panel's included -> every ordinary scope, admin:panel
--
-- `elevated` itself is left where it is. The server ignores it on a program key from now on, but instances still
-- running the previous build while this rolls out keep honouring it.

UPDATE "ProgramKey"
SET "scopes" = array_append("scopes", 'admin:read')
WHERE NOT ('admin:read' = ANY("scopes"));

UPDATE "ProgramKey"
SET "scopes" = array_append("scopes", 'admin:write')
WHERE NOT ('admin:write' = ANY("scopes"))
  AND EXISTS (SELECT 1 FROM unnest("scopes") AS scope WHERE scope = 'elevated' OR scope LIKE '%:write');

UPDATE "ProgramKey"
SET "scopes" = (
    SELECT array_agg(DISTINCT scope)
    FROM unnest("scopes" || ARRAY[
        'timelapse:read', 'timelapse:write', 'snapshot:read', 'snapshot:write',
        'comment:write', 'user:read', 'user:write', 'user:keyrelay',
        'admin:panel'
    ]) AS scope
)
WHERE 'elevated' = ANY("scopes");
