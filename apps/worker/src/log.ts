export class JobLogger {
    jobName: string;
    jobId: string;

    constructor (jobName: string, jobId: string) {
        this.jobName = jobName;
        this.jobId = jobId;
    }

    info(message: string) {
        console.log(`${this.jobName}@${this.jobId}: info: ${message}`);
    }

    warn(message: string) {
        console.warn(`${this.jobName}@${this.jobId}: warn: ${message}`);
    }

    error(message: string) {
        console.error(`${this.jobName}@${this.jobId}: error: ${message}`);
    }

    echo(error: Error) {
        this.error(`${error}`);
        return error;
    }
}