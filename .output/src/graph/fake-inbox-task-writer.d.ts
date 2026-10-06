import type { InboxTask, InboxTaskPort } from './inbox-task.port';
export declare class FakeInboxTaskWriter implements InboxTaskPort {
    readonly tasks: InboxTask[];
    createTask(task: InboxTask): Promise<void>;
}
