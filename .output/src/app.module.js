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
var AppModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("./db/client");
const tenantDb_1 = require("./db/tenantDb");
const tenant_registry_service_1 = require("./tenants/tenant-registry.service");
const job_claim_service_1 = require("./jobs/job-claim.service");
const worker_runner_service_1 = require("./worker/worker-runner.service");
const progress_publisher_service_1 = require("./progress/progress-publisher.service");
const tenant_inbox_task_writer_1 = require("./graph/tenant-inbox-task-writer");
const execution_orchestrator_service_1 = require("./orchestrator/execution-orchestrator.service");
const connectionString = process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
const { db, pool } = (0, client_1.createDb)(connectionString);
const tenantDbFactory = new tenantDb_1.TenantDbFactory(connectionString);
let AppModule = AppModule_1 = class AppModule {
    orchestrator;
    logger = new common_1.Logger(AppModule_1.name);
    stopping = false;
    constructor(orchestrator) {
        this.orchestrator = orchestrator;
    }
    onModuleInit() {
        this.pollLoop();
    }
    async onModuleDestroy() {
        this.stopping = true;
        await pool.end();
        await tenantDbFactory.closeAll();
    }
    async pollLoop() {
        while (!this.stopping) {
            let ran = false;
            try {
                ran = await this.orchestrator.processNext();
            }
            catch (err) {
                this.logger.error(`poll loop iteration failed: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
            }
            await new Promise((resolve) => setTimeout(resolve, ran ? 0 : 1000));
        }
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = AppModule_1 = __decorate([
    (0, common_1.Module)({
        providers: [
            {
                provide: tenant_registry_service_1.TenantRegistryService,
                useFactory: () => new tenant_registry_service_1.TenantRegistryService(db),
            },
            {
                provide: job_claim_service_1.JobClaimService,
                useFactory: () => new job_claim_service_1.JobClaimService(tenantDbFactory),
            },
            worker_runner_service_1.WorkerRunnerService,
            {
                provide: progress_publisher_service_1.ProgressPublisherService,
                useFactory: () => new progress_publisher_service_1.ProgressPublisherService(pool),
            },
            {
                provide: tenant_inbox_task_writer_1.TenantInboxTaskWriter,
                useFactory: () => new tenant_inbox_task_writer_1.TenantInboxTaskWriter(tenantDbFactory),
            },
            execution_orchestrator_service_1.ExecutionOrchestratorService,
        ],
    }),
    __metadata("design:paramtypes", [execution_orchestrator_service_1.ExecutionOrchestratorService])
], AppModule);
//# sourceMappingURL=app.module.js.map