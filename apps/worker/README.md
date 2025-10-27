# Lapse Worker
This microservice handles long-running background tasks. Currently, this only encapsulates video encoding. BullMQ is used to queue all jobs to this microservice, and a shared Redis server between `web` and `worker` is required.

This microservice should **not** be exposed to the Internet.
