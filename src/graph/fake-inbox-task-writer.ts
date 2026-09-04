import type { InboxTask, InboxTaskPort } from './inbox-task.port';

export class FakeInboxTaskWriter implements InboxTaskPort {
  readonly tasks: InboxTask[] = [];

  async createTask(task: InboxTask): Promise<void> {
    this.tasks.push(task);
  }
}
