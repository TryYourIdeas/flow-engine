"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantDbFactory = void 0;
const pg_1 = require("pg");
const node_postgres_1 = require("drizzle-orm/node-postgres");
const tenantSchema = __importStar(require("./schema/tenant"));
const TENANT_POOL_CACHE_SIZE = 20;
const TENANT_POOL_MAX_CONNECTIONS = 3;
class TenantDbFactory {
    connectionString;
    pools = new Map();
    clients = new Map();
    constructor(connectionString) {
        this.connectionString = connectionString;
    }
    touch(schemaName) {
        const db = this.clients.get(schemaName);
        const pool = this.pools.get(schemaName);
        this.clients.delete(schemaName);
        this.pools.delete(schemaName);
        this.clients.set(schemaName, db);
        this.pools.set(schemaName, pool);
    }
    evictOldestIfNeeded() {
        if (this.clients.size < TENANT_POOL_CACHE_SIZE)
            return;
        const oldest = this.clients.keys().next().value;
        const oldestPool = this.pools.get(oldest);
        this.clients.delete(oldest);
        this.pools.delete(oldest);
        void oldestPool?.end();
    }
    getTenantDb(schemaName) {
        if (this.clients.has(schemaName)) {
            this.touch(schemaName);
            return this.clients.get(schemaName);
        }
        this.evictOldestIfNeeded();
        const pool = new pg_1.Pool({
            connectionString: this.connectionString,
            max: TENANT_POOL_MAX_CONNECTIONS,
            options: `-c search_path=${schemaName},public`,
        });
        const db = (0, node_postgres_1.drizzle)(pool, { schema: tenantSchema });
        this.clients.set(schemaName, db);
        this.pools.set(schemaName, pool);
        return db;
    }
    async closeAll() {
        await Promise.all([...this.pools.values()].map((pool) => pool.end()));
        this.pools.clear();
        this.clients.clear();
    }
}
exports.TenantDbFactory = TenantDbFactory;
//# sourceMappingURL=tenantDb.js.map