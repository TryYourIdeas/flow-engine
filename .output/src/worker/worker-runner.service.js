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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
exports.WorkerRunnerService = void 0;
const common_1 = require("@nestjs/common");
const node_worker_threads_1 = require("node:worker_threads");
const path = __importStar(require("node:path"));
let WorkerRunnerService = class WorkerRunnerService {
    async *run(data) {
        const isTs = __filename.endsWith('.ts');
        const workerPath = path.join(__dirname, isTs ? 'graph-execution.worker.ts' : 'graph-execution.worker.js');
        const worker = new node_worker_threads_1.Worker(workerPath, {
            workerData: data,
            execArgv: isTs ? ['-r', 'ts-node/register'] : [],
        });
        const messages = [];
        let resolveNext = null;
        let finished = false;
        worker.on('message', (message) => {
            messages.push(message);
            if (message.kind === 'done' ||
                message.kind === 'error' ||
                message.kind === 'waiting_for_input') {
                finished = true;
            }
            resolveNext?.();
        });
        worker.on('error', (err) => {
            messages.push({ kind: 'error', message: err.message });
            finished = true;
            resolveNext?.();
        });
        worker.on('exit', (code) => {
            if (!finished) {
                messages.push({
                    kind: 'error',
                    message: `worker exited unexpectedly (code ${code})`,
                });
                finished = true;
                resolveNext?.();
            }
        });
        try {
            while (true) {
                while (messages.length > 0) {
                    const message = messages.shift();
                    yield message;
                    if (message.kind === 'done' ||
                        message.kind === 'error' ||
                        message.kind === 'waiting_for_input') {
                        return;
                    }
                }
                if (finished)
                    return;
                await new Promise((resolve) => {
                    resolveNext = resolve;
                });
            }
        }
        finally {
            await worker.terminate();
        }
    }
};
exports.WorkerRunnerService = WorkerRunnerService;
exports.WorkerRunnerService = WorkerRunnerService = __decorate([
    (0, common_1.Injectable)()
], WorkerRunnerService);
//# sourceMappingURL=worker-runner.service.js.map