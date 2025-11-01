export class AsyncQueue {
    private currentTask: Promise<unknown> = Promise.resolve();

    enqueue<T>(task: () => Promise<T>): Promise<T> {
        const promise = this.currentTask.then(() => task());
        this.currentTask = promise.then(
            () => {},
            () => {}
        );
        return promise;
    }

    async synchronize(): Promise<void> {
        return this.enqueue(async () => {});
    }
}