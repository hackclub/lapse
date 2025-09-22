# Hack Club Lapse
[**Lapse**](https://lapse.hackclub.com) is a tool for recording timelapses, which can track time spent working on projects via [Hackatime](https://hackatime.hackclub.com).

## Introduction
Lapse captures timestamped snapshots of a video feed (e.g. a user's screen or camera). Snapshots are always encrypted with a key derived from the user's password (which is not stored on the server) and synchronized with the server. Users can censor and remove snapshots before decrypting them and publishing them.

When a timelapse is published, it can either be set to **public** or **unlisted**. An *unlisted* timelapse can only be viewed by administrators and the author, as well as anyone with a private, uniquely generated URL. A *public* timelapse is publicly shared on the website.

Timelapses can be synchronized with Hackatime. This will create a WakaTime heartbeat for each snapshot. Timelapses that are synchronized can always be reviewed by administrators for fraud.
