"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeInboxTaskWriter = void 0;
class FakeInboxTaskWriter {
    tasks = [];
    async createTask(task) {
        this.tasks.push(task);
    }
}
exports.FakeInboxTaskWriter = FakeInboxTaskWriter;
//# sourceMappingURL=fake-inbox-task-writer.js.map