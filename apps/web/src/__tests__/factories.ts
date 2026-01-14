import { faker } from "@faker-js/faker";
import type {
    User,
    Timelapse,
    Snapshot,
    KnownDevice,
    Comment,
    UploadToken,
    DraftTimelapse,
    BanRecord,
} from "@/generated/prisma/client";
import { PermissionLevel, TimelapseVisibility, VideoContainerKind, BanAction } from "@/generated/prisma/client";

/**
 * Generates a Nano ID-like string (12 characters).
 */
function nanoid(length: number = 12): string {
    return faker.string.alphanumeric({ length });
}

/**
 * Factory functions for generating test data that matches the Prisma schema.
 */
export const testFactory = {
    /**
     * Creates a mock User object.
     */
    user: (overrides: Partial<User> = {}): User => ({
        id: nanoid(12),
        email: faker.internet.email(),
        createdAt: faker.date.past(),
        permissionLevel: PermissionLevel.USER,
        handle: faker.internet.username().toLowerCase().slice(0, 16),
        displayName: faker.person.fullName().slice(0, 24),
        profilePictureUrl: faker.image.avatar(),
        bio: faker.lorem.sentence().slice(0, 160),
        urls: [],
        slackId: null,
        hackatimeId:overrides?.hackatimeId ?? null,
        hackatimeAccessToken: overrides.hackatimeAccessToken ?? null,
        lastHeartbeat: faker.date.recent(),
        hackatimeRefreshToken: overrides?.hackatimeRefreshToken ?? null,
        isBanned: false,
        bannedAt: null,
        bannedReason: "",
        bannedReasonInternal: "",
        ...overrides,
    }),

    /**
     * Creates a mock Timelapse object.
     */
    timelapse: (overrides: Partial<Timelapse> = {}): Timelapse => ({
        id: nanoid(12),
        createdAt: faker.date.past(),
        s3Key: `timelapses/${faker.string.uuid()}.webm`,
        thumbnailS3Key: `thumbnails/${faker.string.uuid()}.jpg`,
        hackatimeProject: null,
        name: faker.lorem.sentence().slice(0, 50),
        description: faker.lorem.paragraph(),
        visibility: TimelapseVisibility.UNLISTED,
        isPublished: false,
        containerKind: VideoContainerKind.WEBM,
        duration: faker.number.float({ min: 5, max: 120 }),
        ownerId: nanoid(12),
        deviceId: null,
        ...overrides,
    }),

    /**
     * Creates a mock Snapshot object.
     */
    snapshot: (overrides: Partial<Snapshot> = {}): Snapshot => ({
        id: faker.string.uuid(),
        frame: faker.number.int({ min: 0, max: 1000 }),
        createdAt: faker.date.past(),
        heartbeatId: 0,
        timelapseId: nanoid(12),
        ...overrides,
    }),

    /**
     * Creates a mock KnownDevice object.
     */
    device: (overrides: Partial<KnownDevice> = {}): KnownDevice => ({
        id: faker.string.uuid(),
        name: faker.commerce.productName(),
        ownerId: nanoid(12),
        ...overrides,
    }),

    /**
     * Creates a mock Comment object.
     */
    comment: (overrides: Partial<Comment> = {}): Comment => ({
        id: nanoid(12),
        authorId: nanoid(12),
        timelapseId: nanoid(12),
        content: faker.lorem.paragraph(),
        createdAt: faker.date.recent(),
        ...overrides,
    }),

    /**
     * Creates a mock UploadToken object.
     */
    uploadToken: (overrides: Partial<UploadToken> = {}): UploadToken => ({
        id: faker.string.uuid(),
        key: `uploads/${faker.string.uuid()}`,
        bucket: "lapse-uploads",
        mimeType: "video/webm",
        uploaded: false,
        expires: faker.date.future(),
        maxSize: 100 * 1024 * 1024,
        ownerId: nanoid(12),
        ...overrides,
    }),

    /**
     * Creates a mock DraftTimelapse object.
     */
    draftTimelapse: (overrides: Partial<DraftTimelapse> = {}): DraftTimelapse => ({
        id: nanoid(12),
        createdAt: faker.date.recent(),
        ownerId: nanoid(12),
        videoTokenId: faker.string.uuid(),
        thumbnailTokenId: faker.string.uuid(),
        ...overrides,
    }),

    /**
     * Creates a mock BanRecord object.
     */
    banRecord: (overrides: Partial<BanRecord> = {}): BanRecord => ({
        id: nanoid(12),
        createdAt: faker.date.recent(),
        action: BanAction.BAN,
        reason: faker.lorem.sentence(),
        reasonInternal: faker.lorem.sentence(),
        targetId: nanoid(12),
        performedById: nanoid(12),
        ...overrides,
    }),
};
