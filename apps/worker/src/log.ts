import * as Sentry from "@sentry/node";

export class JobLogger {
    jobName: string;
    jobId: string;

    constructor (jobName: string, jobId: string) {
        this.jobName = jobName;
        this.jobId = jobId;
    }

    info(message: string) {
        console.log(`${this.jobName}@${this.jobId}: info: ${message}`);
        Sentry.logger.info(`${this.jobName}@${this.jobId}: ${message}`, { lapse_jobName: this.jobName, lapse_jobId: this.jobId });
    }

    warn(message: string) {
        console.warn(`${this.jobName}@${this.jobId}: warn: ${message}`);
        Sentry.logger.warn(`${this.jobName}@${this.jobId}: ${message}`, { lapse_jobName: this.jobName, lapse_jobId: this.jobId });
    }

    error(message: string) {
        console.error(`${this.jobName}@${this.jobId}: error: ${message}`);
        Sentry.logger.error(`${this.jobName}@${this.jobId}: ${message}`, { lapse_jobName: this.jobName, lapse_jobId: this.jobId });
    }

    echo(error: Error) {
        this.error(`${error}`);
        return error;
    }
}