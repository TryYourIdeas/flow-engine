import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export declare class HeartbeatService implements OnModuleInit, OnModuleDestroy {
    private lastHeartbeatAt;
    private intervalHandle;
    onModuleInit(): void;
    onModuleDestroy(): void;
    getLastHeartbeatAt(): Date;
}
