// services/redisClient.js
const { createClient } = require("redis");

const useRedis = process.env.USE_REDIS === "true";
let client = null;

// Mock store imitating basic Redis commands using a JS Map
const mockStore = new Map();
const mockClient = {
    get: async (key) => {
        const entry = mockStore.get(key);
        if (!entry) return null;
        if (entry.expiry && Date.now() > entry.expiry) {
            mockStore.delete(key);
            return null;
        }
        return entry.val;
    },
    set: async (key, val, options = {}) => {
        const entry = { val };
        if (options && options.EX) {
            entry.expiry = Date.now() + options.EX * 1000;
        }
        mockStore.set(key, entry);
        return "OK";
    },
    del: async (key) => {
        const existed = mockStore.has(key);
        mockStore.delete(key);
        return existed ? 1 : 0;
    },
    sAdd: async (key, member) => {
        if (!mockStore.has(key)) {
            mockStore.set(key, new Set());
        }
        const set = mockStore.get(key);
        const sizeBefore = set.size;
        set.add(member.toString());
        return set.size > sizeBefore ? 1 : 0;
    },
    sRem: async (key, member) => {
        if (!mockStore.has(key)) return 0;
        const set = mockStore.get(key);
        const deleted = set.delete(member.toString());
        if (set.size === 0) {
            mockStore.delete(key);
        }
        return deleted ? 1 : 0;
    },
    sMembers: async (key) => {
        if (!mockStore.has(key)) return [];
        const val = mockStore.get(key);
        if (val instanceof Set) {
            return Array.from(val);
        }
        return [];
    },
    connect: async () => {
        console.log("[Redis Mock] Connected successfully");
    },
    quit: async () => {},
    isMock: true
};

if (useRedis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    console.log(`[Redis] Connecting to database at: ${url}`);
    
    client = createClient({ url });
    
    client.on("error", (err) => {
        console.error("[Redis Client Error]", err.message);
    });

    // Proactively connect
    client.connect().catch((err) => {
        console.warn("[Redis] Initial connection failed. Falling back to local Mock store.", err.message);
        // Switch client reference to mockClient
        client = mockClient;
    });
} else {
    console.log("[Redis] Client disabled by config (USE_REDIS=false). Using local Mock store.");
    client = mockClient;
}

module.exports = {
    get: async (key) => client.get(key),
    set: async (key, val, options) => client.set(key, val, options),
    del: async (key) => client.del(key),
    sAdd: async (key, member) => client.sAdd(key, member),
    sRem: async (key, member) => client.sRem(key, member),
    sMembers: async (key) => client.sMembers(key)
};
