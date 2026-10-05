"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobClaimService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
let JobClaimService = class JobClaimService {
    tenantDbFactory;
    constructor(tenantDbFactory) {
        this.tenantDbFactory = tenantDbFactory;
    }
    async claimNext(schemaName) {
        const db = this.tenantDbFactory.getTenantDb(schemaName);
        const result = await db.execute((0, drizzle_orm_1.sql) `
      UPDATE flow_jobs
      SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM flow_jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, graph_id, user_id, run_id, input
    `);
        const row = result.rows[0];
        if (!row)
            return null;
        return {
            id: row.id,
            type: row.type,
            schemaName,
            graphId: row.graph_id,
            userId: row.user_id,
            runId: row.run_id,
            input: row.input,
        };
    }
    async complete(schemaName, jobId) {
        const db = this.tenantDbFactory.getTenantDb(schemaName);
        await db.execute((0, drizzle_orm_1.sql) `
      UPDATE flow_jobs SET status = 'completed', updated_at = now() WHERE id = ${jobId}
    `);
    }
    async fail(schemaName, jobId, error) {
        const db = this.tenantDbFactory.getTenantDb(schemaName);
        await db.execute((0, drizzle_orm_1.sql) `
      UPDATE flow_jobs SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${jobId}
    `);
    }
    async markWaiting(schemaName, jobId, runId) {
        const db = this.tenantDbFactory.getTenantDb(schemaName);
        await db.execute((0, drizzle_orm_1.sql) `
      UPDATE flow_jobs SET status = 'waiting', run_id = ${runId}, updated_at = now() WHERE id = ${jobId}
    `);
    }
};
exports.JobClaimService = JobClaimService;
exports.JobClaimService = JobClaimService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Function])
], JobClaimService);
//# sourceMappingURL=job-claim.service.js.map