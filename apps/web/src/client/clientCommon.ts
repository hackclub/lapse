export function createFormData(fields: Record<string, Blob | string>): FormData {
    const data = new FormData();

    for (const key in fields) {
        if (!Object.hasOwn(fields, key))
            continue;
        
        data.append(key, fields[key]);
    }

    return data;
}