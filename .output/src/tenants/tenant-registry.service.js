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
exports.TenantRegistryService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const public_1 = require("../db/schema/public");
let TenantRegistryService = class TenantRegistryService {
    db;
    constructor(db) {
        this.db = db;
    }
    async listTenantSchemas() {
        const rows = await this.db
            .select({ schemaName: public_1.tenants.schemaName })
            .from(public_1.tenants)
            .orderBy((0, drizzle_orm_1.asc)(public_1.tenants.schemaName));
        return rows.map((r) => r.schemaName);
    }
};
exports.TenantRegistryService = TenantRegistryService;
exports.TenantRegistryService = TenantRegistryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], TenantRegistryService);
//# sourceMappingURL=tenant-registry.service.js.map