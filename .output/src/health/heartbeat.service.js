"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeartbeatService = void 0;
const common_1 = require("@nestjs/common");
const HEARTBEAT_INTERVAL_MS = 1000;
let HeartbeatService = class HeartbeatService {
    lastHeartbeatAt = new Date();
    intervalHandle = null;
    onModuleInit() {
        this.intervalHandle = setInterval(() => {
            this.lastHeartbeatAt = new Date();
        }, HEARTBEAT_INTERVAL_MS);
    }
    onModuleDestroy() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    getLastHeartbeatAt() {
        return this.lastHeartbeatAt;
    }
};
exports.HeartbeatService = HeartbeatService;
exports.HeartbeatService = HeartbeatService = __decorate([
    (0, common_1.Injectable)()
], HeartbeatService);
//# sourceMappingURL=heartbeat.service.js.map