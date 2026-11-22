import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface SchemaField {
    name: string;
    type: string;
    isList: boolean;
    isOptional: boolean;
    /** For a scalar that points at another model's row, that model. */
    references?: string;
}

export interface SchemaModel {
    name: string;
    /** The model's name as the client spells it, e.g. `draftLookoutTimelapse`. */
    key: string;
    scalars: SchemaField[];
    relations: SchemaField[];
}

/**
 * Reads the models of `schema.prisma`. This is a line-based reading of our own schema rather than a Prisma parser:
 * every field is `name Type[]? @attributes` on one line.
 */
export function readSchema(): Map<string, SchemaModel> {
    const source = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");
    const blocks = [...source.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)];
    const enums = new Set([...source.matchAll(/^enum (\w+) \{/gm)].map(x => x[1]!));
    const modelNames = new Set(blocks.map(x => x[1]!));
    const models = new Map<string, SchemaModel>();

    for (const [, name, body] of blocks) {
        const scalars: SchemaField[] = [];
        const relations: SchemaField[] = [];
        const foreignKeys = new Map<string, string>();

        for (const line of body!.split("\n")) {
            const field = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?(\s+.*)?$/.exec(line);
            if (!field || line.trim().startsWith("//"))
                continue;

            const [, fieldName, type, list, optional, attributes] = field;
            const parsed: SchemaField = { name: fieldName!, type: type!, isList: Boolean(list), isOptional: Boolean(optional) };

            if (modelNames.has(type!)) {
                relations.push(parsed);

                const relation = /@relation\((?:"[^"]*",\s*)?fields: \[(\w+)\], references: \[\w+\]/.exec(attributes ?? "");
                if (relation)
                    foreignKeys.set(relation[1]!, type!);
            }
            else {
                scalars.push({ ...parsed, type: enums.has(type!) ? `enum:${type}` : type! });
            }
        }

        for (const scalar of scalars)
            scalar.references = foreignKeys.get(scalar.name);

        models.set(name!, { name: name!, key: name![0]!.toLowerCase() + name!.slice(1), scalars, relations });
    }

    return models;
}

export function readEnums(): Map<string, string[]> {
    const source = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");
    const enums = new Map<string, string[]>();

    for (const [, name, body] of source.matchAll(/^enum (\w+) \{\n([\s\S]*?)^\}/gm)) {
        enums.set(name!, body!.split("\n").map(x => x.trim()).filter(x => /^\w+$/.test(x)));
    }

    return enums;
}
