import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ExecutionOrchestratorService } from './orchestrator/execution-orchestrator.service';
export declare class AppModule implements OnModuleInit, OnModuleDestroy {
    private readonly orchestrator;
    private readonly logger;
    private stopping;
    constructor(orchestrator: ExecutionOrchestratorService);
    onModuleInit(): void;
    onModuleDestroy(): Promise<void>;
    private pollLoop;
}
